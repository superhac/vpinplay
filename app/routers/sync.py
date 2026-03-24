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
            
            # Upsert table variation document
            table_doc = {
                "vpsId": vps_id,
                "rom": table_payload.info.rom,
                "vpxFile": table_payload.vpxFile.dict(),
                "createdAt": received_at,
                "lastSeenAt": received_at,
                "updatedAt": received_at
            }
            
            # Check if this exact variation already exists
            existing_table = tables_col.find_one({
                "vpsId": vps_id,
                "vpxFile": table_payload.vpxFile.dict()
            })
            
            if existing_table:
                # Update lastSeenAt for this variation
                tables_col.update_one(
                    {"_id": existing_table["_id"]},
                    {"$set": {"lastSeenAt": received_at}}
                )
                summary.unchanged += 1
            else:
                tables_col.insert_one(table_doc)
                summary.tablesCreated += 1
            
            # Upsert user state document
            user_state_doc = {
                "userId": user_id,
                "userIdNormalized": user_id,
                "vpsId": vps_id,
                "rating": normalized_rating,
                "lastRun": table_payload.user.lastRun,
                "startCount": table_payload.user.startCount,
                "runTime": table_payload.user.runTime,
                "altvpsid": table_payload.vpinfe.altvpsid,
                "lastSeenAt": received_at,
                "updatedAt": received_at
            }
            
            existing_user_state = user_state_col.find_one(and_user_id_filter(user_id, {"vpsId": vps_id}))
            
            if existing_user_state:
                # Check if anything changed
                has_changes = (
                    existing_user_state.get("rating") != normalized_rating or
                    existing_user_state.get("lastRun") != table_payload.user.lastRun or
                    existing_user_state.get("startCount") != table_payload.user.startCount or
                    existing_user_state.get("runTime") != table_payload.user.runTime or
                    existing_user_state.get("altvpsid") != table_payload.vpinfe.altvpsid
                )
                
                if has_changes:
                    prev_run_time = existing_user_state.get("runTime")
                    new_run_time = table_payload.user.runTime
                    prev_start_count = existing_user_state.get("startCount")
                    new_start_count = table_payload.user.startCount

                    delta_run_time = int(new_run_time or 0) - int(prev_run_time or 0)
                    delta_start_count = int(new_start_count or 0) - int(prev_start_count or 0)

                    # Persist per-sync diff data so analytics can answer "what changed"
                    user_state_deltas_col.insert_one({
                        "userId": user_id,
                        "userIdNormalized": user_id,
                        "vpsId": vps_id,
                        "changedAt": received_at,
                        "prevRating": existing_user_state.get("rating"),
                        "newRating": normalized_rating,
                        "prevLastRun": existing_user_state.get("lastRun"),
                        "newLastRun": table_payload.user.lastRun,
                        "prevStartCount": prev_start_count,
                        "newStartCount": new_start_count,
                        "deltaStartCount": delta_start_count,
                        "prevRunTime": prev_run_time,
                        "newRunTime": new_run_time,
                        "deltaRunTime": delta_run_time,
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
