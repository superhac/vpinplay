import json

from fastapi import APIRouter, Depends
from datetime import datetime
from pymongo.database import Database
from app.models import FullSyncRequest, SyncResponse, SyncSummary
from app.dependencies import get_db
from app.userid import normalize_user_id, user_id_filter, and_user_id_filter

router = APIRouter(
    prefix="/api/v1",
    tags=["sync"]
)


def _coerce_non_negative_int(value) -> int:
    """Coerce arbitrary payload values into non-negative ints for counters."""
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _parse_iso_datetime(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        # Accept both "...Z" and offset-aware ISO strings.
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _merge_last_run(existing_value, incoming_value):
    """Keep the newest non-null lastRun; fallback to incoming on parse ambiguity."""
    if incoming_value is None:
        return existing_value
    if existing_value is None:
        return incoming_value

    existing_dt = _parse_iso_datetime(existing_value)
    incoming_dt = _parse_iso_datetime(incoming_value)

    if existing_dt and incoming_dt:
        return incoming_value if incoming_dt >= existing_dt else existing_value

    # If timestamps are present but not both parseable, prefer latest submitted value.
    return incoming_value


def _normalize_score_payload(value):
    """Accept only object-like score payloads; ignore invalid shapes."""
    return value if isinstance(value, dict) else None


@router.get("/sync/last")
async def get_last_global_sync(db: Database = Depends(get_db)):
    """
    Get the most recent successful sync across all users.
    """
    latest_client = db["client_registry"].find_one(
        {"lastSyncAt": {"$ne": None}},
        sort=[("lastSyncAt", -1)]
    )

    if not latest_client:
        return {"userId": None, "lastSyncAt": None}

    return {
        "userId": latest_client.get("userId"),
        "lastSyncAt": latest_client.get("lastSyncAt")
    }


@router.post("/sync", response_model=SyncResponse)
async def submit_sync(request: FullSyncRequest, db: Database = Depends(get_db)):
    """
    Submit full current state snapshot of tables from a client.
    
    This endpoint accepts all tables the client currently knows about
    and handles upserting them into the database.
    
    Client validation:
    - Both userId and machineId are required
    - First submission with a userId registers it with the machineId
    - Subsequent submissions must use the same machineId for that userId
    
    Note: Collection structure is subject to change based on future optimization.
    """
    # Validate client credentials
    # TODO: Collection structure may change in future implementation
    client_registry = db["client_registry"]
    
    user_id = normalize_user_id(request.client.userId)
    machine_id = request.client.machineId
    
    # Check if machineId is already registered to a different userId
    existing_machine = client_registry.find_one({"machineId": machine_id})
    if existing_machine and normalize_user_id(existing_machine["userId"]) != user_id:
        # Invalid: machineId already used by another user
        return SyncResponse(
            status="error",
            receivedAt=datetime.utcnow(),
            summary=SyncSummary(
                tablesReceived=0,
                tablesCreated=0,
                tablesUpdated=0,
                userStatesCreated=0,
                userStatesUpdated=0,
                unchanged=0,
                errors=len(request.tables)
            )
        )
    
    # Check if userId is already registered
    existing_client = client_registry.find_one(user_id_filter(user_id))
    
    received_at = datetime.utcnow()

    if existing_client:
        # Verify machineId matches
        if existing_client["machineId"] != machine_id:
            # Invalid: userId registered with different machineId
            return SyncResponse(
                status="error",
                receivedAt=datetime.utcnow(),
                summary=SyncSummary(
                    tablesReceived=0,
                    tablesCreated=0,
                    tablesUpdated=0,
                    userStatesCreated=0,
                    userStatesUpdated=0,
                    unchanged=0,
                    errors=len(request.tables)
                )
            )
    else:
        # First time seeing this userId, register it with the machineId
        client_registry.insert_one({
            "userId": user_id,
            "userIdNormalized": user_id,
            "machineId": machine_id,
            "registeredAt": received_at,
            "lastSyncAt": received_at,
            "lastSyncTableCount": len(request.tables),
        })

    # Record latest successful sync time for existing users.
    if existing_client:
        client_registry.update_one(
            {"_id": existing_client["_id"]},
            {"$set": {
                "userId": user_id,
                "userIdNormalized": user_id,
                "lastSyncAt": received_at,
                "lastSyncTableCount": len(request.tables)
            }}
        )

    summary = SyncSummary(
        tablesReceived=len(request.tables),
        tablesCreated=0,
        tablesUpdated=0,
        userStatesCreated=0,
        userStatesUpdated=0,
        unchanged=0,
        errors=0
    )
    
    tables_col = db["tables"]  # TODO: Collection structure may change
    user_state_col = db["user_table_state"]  # TODO: Collection structure may change
    user_state_deltas_col = db["user_table_state_deltas"]  # Per-sync change log for weekly/runtime analytics
    user_ratings_col = db["user_table_ratings"]  # Per-user, per-variation ratings for vote aggregation
    
    for table_payload in request.tables:
        try:
            # Validate vpsId
            if not table_payload.info.vpsId:
                summary.errors += 1
                continue
            
            vps_id = table_payload.info.vpsId
            normalized_rating = (
                table_payload.user.rating
                if table_payload.user.rating is not None and 1 <= table_payload.user.rating <= 5
                else None
            )
            
            vpx_file_data = table_payload.vpxFile.dict()
            vpx_file_signature = json.dumps(vpx_file_data, sort_keys=True, separators=(",", ":"))

            # Upsert table variation document
            table_doc = {
                "vpsId": vps_id,
                "rom": table_payload.info.rom,
                "vpxFile": vpx_file_data,
                "submittedByUserIdsNormalized": [user_id],
                "firstSeenByUserIdNormalized": user_id,
                "createdAt": received_at,
                "lastSeenAt": received_at,
                "updatedAt": received_at
            }
            
            # Check if this exact variation already exists
            existing_table = tables_col.find_one({
                "vpsId": vps_id,
                "vpxFile": vpx_file_data
            })
            
            if existing_table:
                # Update lastSeenAt for this variation
                tables_col.update_one(
                    {"_id": existing_table["_id"]},
                    {
                        "$set": {"lastSeenAt": received_at},
                        "$addToSet": {"submittedByUserIdsNormalized": user_id},
                    }
                )
                summary.unchanged += 1
            else:
                tables_col.insert_one(table_doc)
                summary.tablesCreated += 1

            # Upsert per-variation rating document.
            # This preserves one rating row per user + vpsId + variation, so vote counts
            # can include multiple rated variants under the same vpsId.
            user_ratings_col.update_one(
                {
                    "userIdNormalized": user_id,
                    "vpsId": vps_id,
                    "vpxFileSignature": vpx_file_signature,
                },
                {
                    "$set": {
                        "userId": user_id,
                        "userIdNormalized": user_id,
                        "vpsId": vps_id,
                        "vpxFile": vpx_file_data,
                        "vpxFileSignature": vpx_file_signature,
                        "rating": normalized_rating,
                        "alttitle": table_payload.vpinfe.alttitle,
                        "altvpsid": table_payload.vpinfe.altvpsid,
                        "lastSeenAt": received_at,
                        "updatedAt": received_at,
                    },
                    "$setOnInsert": {
                        "createdAt": received_at,
                    },
                },
                upsert=True,
            )
            
            # Upsert user state document
            incoming_start_count = _coerce_non_negative_int(table_payload.user.startCount)
            incoming_run_time = _coerce_non_negative_int(table_payload.user.runTime)
            incoming_last_run = table_payload.user.lastRun
            incoming_score = _normalize_score_payload(table_payload.score)

            user_state_doc = {
                "userId": user_id,
                "userIdNormalized": user_id,
                "vpsId": vps_id,
                "rating": normalized_rating,
                "lastRun": incoming_last_run,
                "startCount": incoming_start_count,
                "runTime": incoming_run_time,
                "score": incoming_score,
                "alttitle": table_payload.vpinfe.alttitle,
                "altvpsid": table_payload.vpinfe.altvpsid,
                "lastSeenAt": received_at,
                "updatedAt": received_at
            }
            
            existing_user_state = user_state_col.find_one(and_user_id_filter(user_id, {"vpsId": vps_id}))
            
            if existing_user_state:
                prev_run_time = _coerce_non_negative_int(existing_user_state.get("runTime"))
                prev_start_count = _coerce_non_negative_int(existing_user_state.get("startCount"))
                merged_run_time = max(prev_run_time, incoming_run_time)
                merged_start_count = max(prev_start_count, incoming_start_count)
                merged_last_run = _merge_last_run(existing_user_state.get("lastRun"), incoming_last_run)

                user_state_doc["runTime"] = merged_run_time
                user_state_doc["startCount"] = merged_start_count
                user_state_doc["lastRun"] = merged_last_run

                # Check if anything changed
                has_changes = (
                    existing_user_state.get("rating") != normalized_rating or
                    existing_user_state.get("lastRun") != merged_last_run or
                    prev_start_count != merged_start_count or
                    prev_run_time != merged_run_time or
                    existing_user_state.get("score") != incoming_score or
                    existing_user_state.get("alttitle") != table_payload.vpinfe.alttitle or
                    existing_user_state.get("altvpsid") != table_payload.vpinfe.altvpsid
                )
                
                if has_changes:
                    new_run_time = merged_run_time
                    new_start_count = merged_start_count

                    delta_run_time = new_run_time - prev_run_time
                    delta_start_count = new_start_count - prev_start_count

                    # Persist per-sync diff data so analytics can answer "what changed"
                    user_state_deltas_col.insert_one({
                        "userId": user_id,
                        "userIdNormalized": user_id,
                        "vpsId": vps_id,
                        "changedAt": received_at,
                        "prevRating": existing_user_state.get("rating"),
                        "newRating": normalized_rating,
                        "prevLastRun": existing_user_state.get("lastRun"),
                        "newLastRun": merged_last_run,
                        "prevStartCount": prev_start_count,
                        "newStartCount": new_start_count,
                        "deltaStartCount": delta_start_count,
                        "prevRunTime": prev_run_time,
                        "newRunTime": new_run_time,
                        "deltaRunTime": delta_run_time,
                        "prevScore": existing_user_state.get("score"),
                        "newScore": incoming_score,
                        "prevAlttitle": existing_user_state.get("alttitle"),
                        "newAlttitle": table_payload.vpinfe.alttitle,
                        "prevAltvpsid": existing_user_state.get("altvpsid"),
                        "newAltvpsid": table_payload.vpinfe.altvpsid,
                    })

                    user_state_col.update_one(
                        {"_id": existing_user_state["_id"]},
                        {"$set": user_state_doc}
                    )
                    summary.userStatesUpdated += 1
                else:
                    # Just update lastSeenAt
                    user_state_col.update_one(
                        {"_id": existing_user_state["_id"]},
                        {"$set": {"lastSeenAt": received_at, "userId": user_id, "userIdNormalized": user_id}}
                    )
            else:
                user_state_col.insert_one({
                    **user_state_doc,
                    "createdAt": received_at
                })
                summary.userStatesCreated += 1
        
        except Exception as e:
            print(f"Error processing table {table_payload.info.vpsId}: {e}")
            summary.errors += 1
    
    return SyncResponse(
        status="ok",
        receivedAt=received_at,
        summary=summary
    )
