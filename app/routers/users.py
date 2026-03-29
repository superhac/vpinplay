from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from datetime import datetime, timedelta
from pymongo.database import Database
from app.models import UserTableStateResponse
from app.dependencies import get_db
from app.response_enrichment import enrich_with_vpsdb
from app.userid import normalize_user_id, user_id_filter, and_user_id_filter

router = APIRouter(
    prefix="/api/v1",
    tags=["users"]
)


@router.get("/users")
async def get_all_user_ids(
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get all registered userIds (paginated).
    """
    total = db["client_registry"].count_documents({})
    rows = list(
        db["client_registry"]
        .find({}, {"_id": 0, "userId": 1})
        .sort("userId", 1)
        .skip(offset)
        .limit(limit)
    )
    items = [row.get("userId") for row in rows if row.get("userId")]

    return {
        "items": items,
        "pagination": {
            "limit": limit,
            "offset": offset,
            "returned": len(items),
            "total": total,
            "hasNext": (offset + len(items)) < total,
            "hasPrev": offset > 0,
        },
    }


@router.get("/users/count")
async def get_user_count(db: Database = Depends(get_db)):
    """
    Get total number of registered users.
    """
    count = db["client_registry"].count_documents({})
    return {"userCount": count}


@router.get("/users/{userId}/available")
async def check_user_id_available(userId: str, db: Database = Depends(get_db)):
    """
    Check if a userId is available for registration.

    Returns true if the userId is available (not registered), false if taken.
    """
    existing_client = db["client_registry"].find_one(user_id_filter(userId))  # TODO: Collection structure may change
    return {"available": existing_client is None}


@router.get("/users/{userId}/last-sync")
async def get_user_last_sync(userId: str, db: Database = Depends(get_db)):
    """
    Get the user's most recent successful sync timestamp.
    """
    normalized_user_id = normalize_user_id(userId)
    client = db["client_registry"].find_one(user_id_filter(normalized_user_id))  # TODO: Collection structure may change

    if not client:
        raise HTTPException(status_code=404, detail=f"User not found: {normalized_user_id}")

    return {
        "userId": normalized_user_id,
        "lastSyncAt": client.get("lastSyncAt")
    }


@router.get("/users/{userId}/initials")
async def get_user_initials(userId: str, db: Database = Depends(get_db)):
    """
    Get the user's registered initials.
    """
    normalized_user_id = normalize_user_id(userId)
    client = db["client_registry"].find_one(
        user_id_filter(normalized_user_id),
        {"_id": 0, "initials": 1}
    )

    if not client:
        raise HTTPException(status_code=404, detail=f"User not found: {normalized_user_id}")

    return {
        "userId": normalized_user_id,
        "initials": client.get("initials")
    }


@router.get("/users/{userId}/tables/count")
async def get_user_table_count(userId: str, db: Database = Depends(get_db)):
    """
    Get the total count of tables submitted by a user.

    `tableCount` prefers the last full sync table payload count (includes variations).
    Falls back to unique user table-state rows if that sync count is unavailable.
    """
    normalized_user_id = normalize_user_id(userId)
    unique_count = db["user_table_state"].count_documents(user_id_filter(normalized_user_id))  # TODO: Collection structure may change
    client = db["client_registry"].find_one(user_id_filter(normalized_user_id), {"_id": 0, "lastSyncTableCount": 1})
    synced_count = client.get("lastSyncTableCount") if client else None
    table_count = synced_count if synced_count is not None else unique_count

    return {
        "userId": normalized_user_id,
        "tableCount": int(table_count),
        "syncedTableCount": int(synced_count) if synced_count is not None else None,
        "uniqueTableCount": int(unique_count),
    }


@router.get("/users/{userId}/tables/runtime-sum")
async def get_user_runtime_sum(userId: str, db: Database = Depends(get_db)):
    """
    Get the total runTime across all tables for a user.
    """
    normalized_user_id = normalize_user_id(userId)
    pipeline = [
        {"$match": user_id_filter(normalized_user_id)},
        {
            "$group": {
                "_id": None,
                "runTimeTotal": {"$sum": {"$ifNull": ["$runTime", 0]}}
            }
        }
    ]

    result = list(db["user_table_state"].aggregate(pipeline))  # TODO: Collection structure may change
    run_time_total = int(result[0]["runTimeTotal"]) if result else 0

    return {"userId": normalized_user_id, "runTimeTotal": run_time_total}


@router.get("/users/{userId}/tables/runtime-weekly")
async def get_user_runtime_weekly(
    userId: str,
    days: int = Query(7, ge=1, le=365),
    db: Database = Depends(get_db)
):
    """
    Get runtime played for the trailing N days using per-sync runtime deltas.
    Only positive deltaRunTime values are counted.
    """
    now = datetime.utcnow()
    since = now - timedelta(days=days)

    normalized_user_id = normalize_user_id(userId)
    pipeline = [
        {
            "$match": {
                "$and": [
                    user_id_filter(normalized_user_id),
                    {"changedAt": {"$gte": since}},
                    {"deltaRunTime": {"$gt": 0}},
                ],
            }
        },
        {
            "$group": {
                "_id": None,
                "runTimePlayed": {"$sum": "$deltaRunTime"},
                "changeEvents": {"$sum": 1},
            }
        }
    ]

    result = list(db["user_table_state_deltas"].aggregate(pipeline))
    run_time_played = int(result[0]["runTimePlayed"]) if result else 0
    change_events = int(result[0]["changeEvents"]) if result else 0

    return {
        "userId": normalized_user_id,
        "days": days,
        "from": since,
        "to": now,
        "runTimePlayed": run_time_played,
        "changeEvents": change_events,
    }


@router.get("/users/{userId}/tables/start-count-sum")
async def get_user_start_count_sum(userId: str, db: Database = Depends(get_db)):
    """
    Get the total startCount across all tables for a user.
    """
    normalized_user_id = normalize_user_id(userId)
    pipeline = [
        {"$match": user_id_filter(normalized_user_id)},
        {
            "$group": {
                "_id": None,
                "startCountTotal": {"$sum": {"$ifNull": ["$startCount", 0]}}
            }
        }
    ]

    result = list(db["user_table_state"].aggregate(pipeline))  # TODO: Collection structure may change
    start_count_total = int(result[0]["startCountTotal"]) if result else 0

    return {"userId": normalized_user_id, "startCountTotal": start_count_total}


@router.get("/users/{userId}/tables/start-count-weekly")
async def get_user_start_count_weekly(
    userId: str,
    days: int = Query(7, ge=1, le=365),
    db: Database = Depends(get_db)
):
    """
    Get number of plays for the trailing N days using per-sync startCount deltas.
    Only positive deltaStartCount values are counted.
    """
    now = datetime.utcnow()
    since = now - timedelta(days=days)

    normalized_user_id = normalize_user_id(userId)
    pipeline = [
        {
            "$match": {
                "$and": [
                    user_id_filter(normalized_user_id),
                    {"changedAt": {"$gte": since}},
                    {"deltaStartCount": {"$gt": 0}},
                ],
            }
        },
        {
            "$group": {
                "_id": None,
                "startCountPlayed": {"$sum": "$deltaStartCount"},
                "changeEvents": {"$sum": 1},
            }
        }
    ]

    result = list(db["user_table_state_deltas"].aggregate(pipeline))
    start_count_played = int(result[0]["startCountPlayed"]) if result else 0
    change_events = int(result[0]["changeEvents"]) if result else 0

    return {
        "userId": normalized_user_id,
        "days": days,
        "from": since,
        "to": now,
        "startCountPlayed": start_count_played,
        "changeEvents": change_events,
    }


@router.get("/users/top-activity")
async def get_top_users_by_activity(
    metric: str = Query("startCountPlayed", pattern="^(startCountPlayed|runTimePlayed)$"),
    days: int = Query(7, ge=1, le=365),
    limit: int = Query(5, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get top users by trailing N-day activity from per-sync deltas.

    `metric`:
      - startCountPlayed: sum of positive deltaStartCount
      - runTimePlayed: sum of positive deltaRunTime (minutes)
    """
    now = datetime.utcnow()
    since = now - timedelta(days=days)

    pipeline = [
        {"$match": {"changedAt": {"$gte": since}}},
        {
            "$group": {
                "_id": "$userId",
                "startCountPlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaStartCount", 0]},
                            "$deltaStartCount",
                            0,
                        ]
                    }
                },
                "runTimePlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaRunTime", 0]},
                            "$deltaRunTime",
                            0,
                        ]
                    }
                },
                "changeEvents": {"$sum": 1},
                "lastChangedAt": {"$max": "$changedAt"},
            }
        },
        {
            "$project": {
                "_id": 0,
                "userId": "$_id",
                "startCountPlayed": 1,
                "runTimePlayed": 1,
                "changeEvents": 1,
                "lastChangedAt": 1,
            }
        },
        {"$match": {metric: {"$gt": 0}}},
        {"$sort": {metric: -1, "changeEvents": -1, "userId": 1}},
        {"$skip": offset},
        {"$limit": limit},
    ]

    rows = list(db["user_table_state_deltas"].aggregate(pipeline))
    items = [
        {
            "userId": row.get("userId"),
            "startCountPlayed": int(row.get("startCountPlayed", 0)),
            "runTimePlayed": int(row.get("runTimePlayed", 0)),
            "changeEvents": int(row.get("changeEvents", 0)),
            "lastChangedAt": row.get("lastChangedAt"),
        }
        for row in rows
    ]

    return {
        "metric": metric,
        "days": days,
        "from": since,
        "to": now,
        "limit": limit,
        "offset": offset,
        "items": items,
    }


def _map_user_states(states: list[dict], db: Database) -> list[UserTableStateResponse]:
    response_rows = [
        {
            "userId": state["userId"],
            "vpsId": state["vpsId"],
            "rating": state.get("rating"),
            "lastRun": state.get("lastRun"),
            "startCount": state.get("startCount", 0),
            "runTime": state.get("runTime", 0),
            "score": state.get("score"),
            "alttitle": state.get("alttitle"),
            "altvpsid": state.get("altvpsid"),
            "createdAt": state.get("createdAt"),
            "updatedAt": state["updatedAt"],
            "lastSeenAt": state["lastSeenAt"],
        }
        for state in states
    ]
    enriched = enrich_with_vpsdb(response_rows, db)
    return [UserTableStateResponse(**row) for row in enriched]


def _get_case_insensitive_value(obj: dict | None, key: str):
    if not isinstance(obj, dict):
        return None
    wanted = str(key).lower()
    for existing_key, value in obj.items():
        if str(existing_key).lower() == wanted:
            return value
    return None


def _get_score_payload(row: dict) -> dict | None:
    direct = _get_case_insensitive_value(row, "score")
    if isinstance(direct, dict):
        return direct

    user = _get_case_insensitive_value(row, "user")
    nested = _get_case_insensitive_value(user, "score")
    if isinstance(nested, dict):
        return nested

    return None


def _extract_matching_score_entries(score_payload: dict, target_initials: str) -> list[dict]:
    normalized_target = str(target_initials or "").strip().upper()
    if not normalized_target:
        return []

    def looks_like_direct_score_entry(payload: dict) -> bool:
        if not isinstance(payload, dict):
            return False
        score_value = _get_case_insensitive_value(payload, "value")
        score_type = _get_case_insensitive_value(payload, "score_type") or _get_case_insensitive_value(payload, "scoreType")
        rom = _get_case_insensitive_value(payload, "rom") or _get_case_insensitive_value(payload, "resolved_rom")
        return score_value is not None or bool(str(score_type or "").strip()) or bool(str(rom or "").strip())

    def entry_matches(entry: dict) -> bool:
        entry_initials = _get_case_insensitive_value(entry, "initials")
        return isinstance(entry_initials, str) and entry_initials.strip().upper() == normalized_target

    entries = _get_case_insensitive_value(score_payload, "entries")
    if isinstance(entries, list):
        matched_entries = [entry for entry in entries if isinstance(entry, dict) and entry_matches(entry)]
        if matched_entries:
            return matched_entries

    if entry_matches(score_payload):
        return [score_payload]

    # Some clients submit a single direct score object without per-entry initials.
    # Treat that as the submitting user's latest score so it still appears in
    # latest-score views.
    if _get_case_insensitive_value(score_payload, "initials") is None and looks_like_direct_score_entry(score_payload):
        return [score_payload]

    return []


def _score_entry_label(score_payload: dict, entry: dict) -> str:
    for source in (entry, score_payload):
        for key in ("label", "section", "score_type", "scoreType"):
            value = _get_case_insensitive_value(source, key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return "Score"


def _clean_table_filename(filename: str | None) -> str | None:
    if not isinstance(filename, str):
        return None
    cleaned = filename.strip()
    if not cleaned:
        return None
    if cleaned.lower().endswith(".vpx"):
        cleaned = cleaned[:-4]
    return cleaned or None


def _enrich_extracted_scores_with_table_titles(rows: list[dict], db: Database) -> list[dict]:
    if not rows:
        return rows

    vps_ids = [row.get("vpsId") for row in rows if row.get("vpsId")]
    title_by_vps_id: dict[str, str] = {}

    if vps_ids:
        table_rows = db["tables"].find(
            {"vpsId": {"$in": list(dict.fromkeys(vps_ids))}},
            {"_id": 0, "vpsId": 1, "vpxFile.filename": 1, "updatedAt": 1},
        ).sort([("updatedAt", -1), ("vpsId", 1)])

        for table in table_rows:
            vps_id = table.get("vpsId")
            if not vps_id or vps_id in title_by_vps_id:
                continue
            filename = ((table.get("vpxFile") or {}).get("filename"))
            cleaned_title = _clean_table_filename(filename)
            if cleaned_title:
                title_by_vps_id[vps_id] = cleaned_title

    for row in rows:
        vpsdb_name = ((row.get("vpsdb") or {}).get("name"))
        state_alttitle = row.get("tableTitle")
        table_title = (
            (vpsdb_name.strip() if isinstance(vpsdb_name, str) and vpsdb_name.strip() else None)
            or (state_alttitle.strip() if isinstance(state_alttitle, str) and state_alttitle.strip() else None)
            or title_by_vps_id.get(row.get("vpsId"))
            or row.get("vpsId")
        )
        row["tableTitle"] = table_title

    return rows


def _build_extracted_score_items(state: dict, normalized_user_id: str, initials: str) -> list[dict]:
    score_payload = _get_score_payload(state)
    if not score_payload:
        return []

    items = []
    for entry in _extract_matching_score_entries(score_payload, initials):
        items.append({
            "userId": normalized_user_id,
            "initials": initials,
            "vpsId": state.get("vpsId"),
            "tableTitle": state.get("alttitle"),
            "label": _score_entry_label(score_payload, entry),
            "updatedAt": state.get("updatedAt"),
            "score": entry,
        })
    return items


def _score_item_numeric_value(item: dict) -> float | None:
    score = ((item or {}).get("score") or {})
    value = _get_case_insensitive_value(score, "score")
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if numeric == numeric else None


def _score_item_sort_key(item: dict):
    numeric_value = _score_item_numeric_value(item)
    updated_at = item.get("updatedAt")
    return (
        -(numeric_value if numeric_value is not None else float("-inf")),
        str(updated_at or ""),
        str(item.get("userId") or ""),
    )


def _best_score_item_key(item: dict) -> tuple[str, str, str]:
    score = ((item or {}).get("score") or {})
    return (
        str(item.get("userId") or "").strip().lower(),
        str(item.get("vpsId") or "").strip(),
        str(_get_case_insensitive_value(score, "section") or item.get("label") or "").strip().lower(),
    )


def _pick_better_score_item(existing: dict | None, candidate: dict) -> dict:
    if existing is None:
        return candidate

    existing_numeric = _score_item_numeric_value(existing)
    candidate_numeric = _score_item_numeric_value(candidate)

    if candidate_numeric is not None and existing_numeric is not None and candidate_numeric != existing_numeric:
        return candidate if candidate_numeric > existing_numeric else existing
    if candidate_numeric is not None and existing_numeric is None:
        return candidate
    if candidate_numeric is None and existing_numeric is not None:
        return existing

    existing_updated_at = str(existing.get("updatedAt") or "")
    candidate_updated_at = str(candidate.get("updatedAt") or "")
    if candidate_updated_at != existing_updated_at:
        return candidate if candidate_updated_at > existing_updated_at else existing

    return candidate if str(candidate.get("userId") or "") < str(existing.get("userId") or "") else existing


@router.get("/users/tables/with-score", response_model=List[UserTableStateResponse])
async def get_all_users_tables_with_score(
    vpsId: str = Query(..., min_length=1, description="Filter to a specific VPS ID"),
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get all user table states with a submitted score payload for one specific table.

    Required query parameters:
    - vpsId: Canonical VPS table ID to filter on

    Optional query parameters:
    - limit: Maximum number of results (default 100, max 100)
    - offset: Number of results to skip (default 0)
    """
    user_states = list(
        db["user_table_state"]
        .find({
            "$and": [
                {"vpsId": vpsId},
                {"score": {"$type": "object"}},
            ]
        })
        .sort([("updatedAt", -1), ("userId", 1)])
        .skip(offset)
        .limit(limit)
    )

    return _map_user_states(user_states, db)


@router.get("/users/scores/latest")
async def get_all_users_latest_matching_scores(
    vpsId: str | None = Query(None, min_length=1, description="Optional VPS ID filter"),
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get the latest extracted score entries across all users where each score entry's
    initials match that submitting user's registered initials.

    Optional query parameters:
    - vpsId: Restrict results to one canonical VPS table ID
    - limit: Maximum number of extracted score entries (default 100, max 100)
    - offset: Number of extracted score entries to skip (default 0)
    """
    client_rows = list(
        db["client_registry"].find({}, {"_id": 0, "userId": 1, "userIdNormalized": 1, "initials": 1})
    )
    initials_by_user_id = {}
    for client in client_rows:
        normalized_user_id = normalize_user_id(client.get("userIdNormalized") or client.get("userId") or "")
        initials = str(client.get("initials") or "").strip()
        if normalized_user_id and initials:
            initials_by_user_id[normalized_user_id] = initials

    query = {"score": {"$type": "object"}}
    if vpsId:
        query = {"$and": [query, {"vpsId": vpsId}]}

    user_states = list(
        db["user_table_state"]
        .find(query)
        .sort([("updatedAt", -1), ("userId", 1), ("vpsId", 1)])
    )

    extracted_items = []
    for state in user_states:
        normalized_user_id = normalize_user_id(state.get("userIdNormalized") or state.get("userId") or "")
        initials = initials_by_user_id.get(normalized_user_id)
        if not normalized_user_id or not initials:
            continue
        extracted_items.extend(_build_extracted_score_items(state, normalized_user_id, initials))

    paged_items = enrich_with_vpsdb(extracted_items[offset:offset + limit], db)
    paged_items = _enrich_extracted_scores_with_table_titles(paged_items, db)
    return {
        "limit": limit,
        "offset": offset,
        "returned": len(paged_items),
        "items": paged_items,
    }


@router.get("/users/scores/best-ever")
async def get_all_users_best_ever_matching_scores(
    vpsId: str = Query(..., min_length=1, description="Required VPS ID filter"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get the best historical extracted score entries for one table across all users,
    where each score entry's initials match that submitting user's registered initials.

    History is sourced from the current user table state plus score snapshots stored in
    per-sync deltas. Results are consolidated down to each user's best entry per section.
    """
    client_rows = list(
        db["client_registry"].find({}, {"_id": 0, "userId": 1, "userIdNormalized": 1, "initials": 1})
    )
    initials_by_user_id = {}
    for client in client_rows:
        normalized_user_id = normalize_user_id(client.get("userIdNormalized") or client.get("userId") or "")
        initials = str(client.get("initials") or "").strip()
        if normalized_user_id and initials:
            initials_by_user_id[normalized_user_id] = initials

    extracted_items = []

    current_states = list(
        db["user_table_state"].find(
            {
                "$and": [
                    {"vpsId": vpsId},
                    {"score": {"$type": "object"}},
                ]
            },
            {
                "_id": 0,
                "userId": 1,
                "userIdNormalized": 1,
                "vpsId": 1,
                "score": 1,
                "alttitle": 1,
                "updatedAt": 1,
            },
        )
    )
    for state in current_states:
        normalized_user_id = normalize_user_id(state.get("userIdNormalized") or state.get("userId") or "")
        initials = initials_by_user_id.get(normalized_user_id)
        if not normalized_user_id or not initials:
            continue
        extracted_items.extend(_build_extracted_score_items(state, normalized_user_id, initials))

    delta_rows = list(
        db["user_table_state_deltas"].find(
            {
                "$and": [
                    {"vpsId": vpsId},
                    {
                        "$or": [
                            {"newScore": {"$type": "object"}},
                            {"prevScore": {"$type": "object"}},
                        ]
                    },
                ]
            },
            {
                "_id": 0,
                "userId": 1,
                "userIdNormalized": 1,
                "vpsId": 1,
                "prevScore": 1,
                "newScore": 1,
                "changedAt": 1,
            },
        )
    )
    for delta in delta_rows:
        normalized_user_id = normalize_user_id(delta.get("userIdNormalized") or delta.get("userId") or "")
        initials = initials_by_user_id.get(normalized_user_id)
        if not normalized_user_id or not initials:
            continue

        for score_field in ("prevScore", "newScore"):
            score_payload = delta.get(score_field)
            if not isinstance(score_payload, dict):
                continue
            extracted_items.extend(_build_extracted_score_items(
                {
                    "userId": normalized_user_id,
                    "vpsId": vpsId,
                    "score": score_payload,
                    "updatedAt": delta.get("changedAt"),
                    "alttitle": None,
                },
                normalized_user_id,
                initials,
            ))

    best_by_key: dict[tuple[str, str, str], dict] = {}
    for item in extracted_items:
        key = _best_score_item_key(item)
        best_by_key[key] = _pick_better_score_item(best_by_key.get(key), item)

    consolidated_items = list(best_by_key.values())
    consolidated_items.sort(key=_score_item_sort_key)
    paged_items = enrich_with_vpsdb(consolidated_items[offset:offset + limit], db)
    paged_items = _enrich_extracted_scores_with_table_titles(paged_items, db)
    return {
        "vpsId": vpsId,
        "limit": limit,
        "offset": offset,
        "returned": len(paged_items),
        "total": len(consolidated_items),
        "items": paged_items,
    }


@router.get("/users/{userId}/tables/top-rated", response_model=List[UserTableStateResponse])
async def get_user_top_rated_tables(
    userId: str,
    limit: int = Query(5, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get top N highest-rated tables for a user.
    """
    # Exclude unrated entries (rating null) for top-rated selection
    # Sort strictly by rating desc (5 → 1)
    top_states = list(db["user_table_state"].find({
        "$and": [
            user_id_filter(userId),
            {"rating": {"$gte": 1, "$lte": 5}},
        ]
    })
                      .sort("rating", -1)
                      .skip(offset)
                      .limit(limit))

    return _map_user_states(top_states, db)


@router.get("/users/{userId}/tables/recently-played", response_model=List[UserTableStateResponse])
async def get_user_recently_played_tables(
    userId: str,
    limit: int = Query(5, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get the most recently played tables for a user.
    """
    recent_states = list(
        db["user_table_state"]
        .find({
            "$and": [
                user_id_filter(userId),
                {"lastRun": {"$ne": None}},
            ]
        })
        .sort("lastRun", -1)
        .skip(offset)
        .limit(limit)
    )

    return _map_user_states(recent_states, db)


@router.get("/users/{userId}/tables/top-play-time", response_model=List[UserTableStateResponse])
async def get_user_top_play_time_tables(
    userId: str,
    limit: int = Query(5, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get top N tables for a user by runTime (highest first).
    """
    top_runtime_states = list(
        db["user_table_state"]
        .find({
            "$and": [
                user_id_filter(userId),
                {"runTime": {"$ne": None}},
            ]
        })
        .sort("runTime", -1)
        .skip(offset)
        .limit(limit)
    )

    return _map_user_states(top_runtime_states, db)


@router.get("/users/{userId}/tables/most-played", response_model=List[UserTableStateResponse])
async def get_user_most_played_tables(
    userId: str,
    limit: int = Query(1, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get most played tables for a user by startCount (highest first).
    """
    most_played_states = list(
        db["user_table_state"]
        .find({
            "$and": [
                user_id_filter(userId),
                {"startCount": {"$ne": None}},
            ]
        })
        .sort("startCount", -1)
        .skip(offset)
        .limit(limit)
    )

    return _map_user_states(most_played_states, db)


@router.get("/users/{userId}/tables/newly-added", response_model=List[UserTableStateResponse])
async def get_user_newly_added_tables(
    userId: str,
    limit: int = Query(5, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get the newest tables added for a user by first-seen timestamp.
    """
    user_states = list(
        db["user_table_state"]
        .find(user_id_filter(userId))
        .sort("createdAt", -1)
        .skip(offset)
        .limit(limit)
    )

    return _map_user_states(user_states, db)


@router.get("/users/{userId}/tables/with-score", response_model=List[UserTableStateResponse])
async def get_user_tables_with_score(
    userId: str,
    vpsId: str | None = Query(None, min_length=1, description="Optional VPS ID filter"),
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get all current table states for a user where a score payload has been submitted.

    Optional query parameters:
    - vpsId: Restrict results to one canonical VPS table ID
    - limit: Maximum number of results (default 100, max 100)
    - offset: Number of results to skip (default 0)
    """
    query = {
        "$and": [
            user_id_filter(userId),
            {"score": {"$type": "object"}},
        ]
    }
    if vpsId:
        query["$and"].append({"vpsId": vpsId})

    user_states = list(
        db["user_table_state"]
        .find(query)
        .sort("updatedAt", -1)
        .skip(offset)
        .limit(limit)
    )

    return _map_user_states(user_states, db)


@router.get("/users/{userId}/scores/latest")
async def get_user_latest_matching_scores(
    userId: str,
    vpsId: str | None = Query(None, min_length=1, description="Optional VPS ID filter"),
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get the latest extracted score entries for a user where entry initials match
    the user's registered initials.

    Optional query parameters:
    - vpsId: Restrict results to one canonical VPS table ID
    - limit: Maximum number of extracted score entries (default 100, max 100)
    - offset: Number of extracted score entries to skip (default 0)
    """
    normalized_user_id = normalize_user_id(userId)
    client = db["client_registry"].find_one(
        user_id_filter(normalized_user_id),
        {"_id": 0, "initials": 1}
    )

    if not client:
        raise HTTPException(status_code=404, detail=f"User not found: {normalized_user_id}")

    initials = str(client.get("initials") or "").strip()
    if not initials:
        return {
            "userId": normalized_user_id,
            "initials": "",
            "limit": limit,
            "offset": offset,
            "returned": 0,
            "items": [],
        }

    query = {
        "$and": [
            user_id_filter(normalized_user_id),
            {"score": {"$type": "object"}},
        ]
    }
    if vpsId:
        query["$and"].append({"vpsId": vpsId})

    user_states = list(
        db["user_table_state"]
        .find(query)
        .sort([("updatedAt", -1), ("vpsId", 1)])
    )

    extracted_items = []
    for state in user_states:
        extracted_items.extend(_build_extracted_score_items(state, normalized_user_id, initials))

    paged_items = enrich_with_vpsdb(extracted_items[offset:offset + limit], db)
    paged_items = _enrich_extracted_scores_with_table_titles(paged_items, db)
    return {
        "userId": normalized_user_id,
        "initials": initials,
        "limit": limit,
        "offset": offset,
        "returned": len(paged_items),
        "items": paged_items,
    }


@router.get("/users/{userId}/tables/{vpsId}", response_model=UserTableStateResponse)
async def get_user_table_state(
    userId: str,
    vpsId: str,
    db: Database = Depends(get_db)
):
    """
    Get current user state for a specific table.

    Returns the per-user metadata for a table including rating, lastRun, playTime, etc.
    """
    normalized_user_id = normalize_user_id(userId)
    user_state = db["user_table_state"].find_one(and_user_id_filter(normalized_user_id, {"vpsId": vpsId}))  # TODO: Collection structure may change

    if not user_state:
        raise HTTPException(
            status_code=404,
            detail=f"User state not found for userId={normalized_user_id}, vpsId={vpsId}"
        )

    return _map_user_states([user_state], db)[0]


@router.get("/users/{userId}/tables", response_model=List[UserTableStateResponse])
async def get_user_all_tables(
    userId: str,
    limit: int = Query(100, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get all current table states for a user.

    Optional query parameters:
    - limit: Maximum number of results (default 100, max 100)
    - offset: Number of results to skip (default 0)
    """
    user_states = list(db["user_table_state"].find(  # TODO: Collection structure may change
        user_id_filter(userId)
    ).skip(offset).limit(limit))

    return _map_user_states(user_states, db)
