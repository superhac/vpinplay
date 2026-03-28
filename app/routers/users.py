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
