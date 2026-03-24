from fastapi import APIRouter, Depends, Query
from typing import List
from datetime import datetime, timedelta
from pymongo.database import Database

from app.dependencies import get_db
from app.models import GlobalTableResponse
from app.response_enrichment import enrich_with_vpsdb
from app.vpsdb import get_vpsdb_sync_status

router = APIRouter(
    prefix="/api/v1",
    tags=["tables"]
)


@router.get("/tables/top-rated")
async def get_global_top_rated_tables(
    limit: int = Query(5, ge=1, le=100),
    db: Database = Depends(get_db)
):
    """
    Get top tables by cumulative average rating across all users.
    """
    pipeline = [
        {"$match": {"rating": {"$gte": 1, "$lte": 5}}},
        {
            "$group": {
                "_id": "$vpsId",
                "avgRating": {"$avg": "$rating"},
                "ratingCount": {"$sum": 1}
            }
        },
        {"$sort": {"avgRating": -1, "ratingCount": -1, "_id": 1}},
        {"$limit": limit}
    ]

    results = list(db["user_table_state"].aggregate(pipeline))
    response = [
        {
            "vpsId": item["_id"],
            "avgRating": round(float(item["avgRating"]), 3),
            "ratingCount": item["ratingCount"]
        }
        for item in results
    ]
    return enrich_with_vpsdb(response, db)


@router.get("/tables/{vpsId}/rating-summary")
async def get_global_table_rating_summary(vpsId: str, db: Database = Depends(get_db)):
    """
    Get cumulative average rating for a specific table across all users.
    Includes both average rating and number of ratings.
    """
    pipeline = [
        {"$match": {"vpsId": vpsId, "rating": {"$gte": 1, "$lte": 5}}},
        {
            "$group": {
                "_id": "$vpsId",
                "avgRating": {"$avg": "$rating"},
                "ratingCount": {"$sum": 1}
            }
        }
    ]

    results = list(db["user_table_state"].aggregate(pipeline))
    if not results:
        response = [{"vpsId": vpsId, "avgRating": None, "ratingCount": 0}]
        return enrich_with_vpsdb(response, db)[0]

    row = results[0]
    response = [{
        "vpsId": row["_id"],
        "avgRating": round(float(row["avgRating"]), 3),
        "ratingCount": int(row["ratingCount"]),
    }]
    return enrich_with_vpsdb(response, db)[0]


@router.get("/tables/newly-added")
async def get_global_new_tables(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get cumulatively new tables seen globally (first time each vpsId was observed).
    """
    pipeline = [
        {
            "$project": {
                "vpsId": 1,
                "createdAtOrUpdatedAt": {"$ifNull": ["$createdAt", "$updatedAt"]},
            }
        },
        {
            "$group": {
                "_id": "$vpsId",
                "firstSeenAt": {"$min": "$createdAtOrUpdatedAt"},
                "variationCount": {"$sum": 1}
            }
        },
        {"$sort": {"firstSeenAt": -1, "_id": 1}},
        {"$skip": offset},
        {"$limit": limit},
    ]

    rows = list(db["tables"].aggregate(pipeline))
    response = [
        {
            "vpsId": row["_id"],
            "firstSeenAt": row.get("firstSeenAt"),
            "variationCount": int(row.get("variationCount", 0)),
        }
        for row in rows
    ]
    return enrich_with_vpsdb(response, db)


@router.get("/tables/top-play-time")
async def get_global_top_play_time_tables(
    limit: int = Query(5, ge=1, le=100),
    db: Database = Depends(get_db)
):
    """
    Get top tables by cumulative runTime across all users.
    runTime is stored in minutes.
    """
    pipeline = [
        {
            "$group": {
                "_id": "$vpsId",
                "runTimeTotal": {"$sum": {"$ifNull": ["$runTime", 0]}},
                "startCountTotal": {"$sum": {"$ifNull": ["$startCount", 0]}},
                "playerCount": {"$sum": 1},
            }
        },
        {"$sort": {"runTimeTotal": -1, "startCountTotal": -1, "_id": 1}},
        {"$limit": limit}
    ]

    rows = list(db["user_table_state"].aggregate(pipeline))
    response = [
        {
            "vpsId": row["_id"],
            "runTimeTotal": int(row.get("runTimeTotal", 0)),
            "startCountTotal": int(row.get("startCountTotal", 0)),
            "playerCount": int(row.get("playerCount", 0)),
        }
        for row in rows
    ]
    return enrich_with_vpsdb(response, db)


@router.get("/tables/top-variants")
async def get_global_top_variant_tables(
    limit: int = Query(5, ge=1, le=100),
    db: Database = Depends(get_db)
):
    """
    Get top tables by number of known variants (highest first).
    """
    pipeline = [
        {"$group": {"_id": "$vpsId", "variationCount": {"$sum": 1}}},
        {"$sort": {"variationCount": -1, "_id": 1}},
        {"$limit": limit},
    ]

    rows = list(db["tables"].aggregate(pipeline))
    response = [
        {
            "vpsId": row["_id"],
            "variationCount": int(row.get("variationCount", 0)),
        }
        for row in rows
    ]
    return enrich_with_vpsdb(response, db)


@router.get("/tables/activity-weekly")
async def get_global_weekly_activity(
    days: int = Query(7, ge=1, le=365),
    db: Database = Depends(get_db)
):
    """
    Get cumulative global activity over trailing N days from sync deltas.
    Counts only positive runtime/start-count deltas.
    """
    now = datetime.utcnow()
    since = now - timedelta(days=days)

    pipeline = [
        {
            "$match": {
                "changedAt": {"$gte": since},
            }
        },
        {
            "$group": {
                "_id": None,
                "runTimePlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaRunTime", 0]},
                            "$deltaRunTime",
                            0
                        ]
                    }
                },
                "startCountPlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaStartCount", 0]},
                            "$deltaStartCount",
                            0
                        ]
                    }
                },
                "changeEvents": {"$sum": 1},
                "distinctUsers": {"$addToSet": "$userId"},
                "distinctTables": {"$addToSet": "$vpsId"},
            }
        },
        {
            "$project": {
                "_id": 0,
                "runTimePlayed": 1,
                "startCountPlayed": 1,
                "changeEvents": 1,
                "userCount": {"$size": "$distinctUsers"},
                "tableCount": {"$size": "$distinctTables"},
            }
        }
    ]

    result = list(db["user_table_state_deltas"].aggregate(pipeline))
    row = result[0] if result else {}

    return {
        "days": days,
        "from": since,
        "to": now,
        "runTimePlayed": int(row.get("runTimePlayed", 0)),
        "startCountPlayed": int(row.get("startCountPlayed", 0)),
        "changeEvents": int(row.get("changeEvents", 0)),
        "userCount": int(row.get("userCount", 0)),
        "tableCount": int(row.get("tableCount", 0)),
    }


@router.get("/tables")
async def get_all_tables(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get all table variation rows with pagination.
    """
    total = db["tables"].count_documents({})
    pipeline = [
        {
            "$lookup": {
                "from": "vpsdb_aux",
                "localField": "vpsId",
                "foreignField": "_id",
                "as": "vpsdbDoc",
            }
        },
        {
            "$addFields": {
                "sortName": {
                    "$let": {
                        "vars": {"firstVpsdb": {"$arrayElemAt": ["$vpsdbDoc", 0]}},
                        "in": {
                            "$toLower": {
                                "$ifNull": ["$$firstVpsdb.data.name", ""]
                            }
                        },
                    }
                }
            }
        },
        {"$sort": {"sortName": 1, "vpsId": 1, "updatedAt": -1}},
        {"$skip": offset},
        {"$limit": limit},
        {
            "$project": {
                "vpsId": 1,
                "vpxFile.filehash": 1,
                "vpxFile.filename": 1,
                "createdAt": 1,
                "updatedAt": 1,
            }
        },
    ]
    rows = list(db["tables"].aggregate(pipeline))

    response = [
        {
            "vpsId": row.get("vpsId"),
            "filename": row.get("vpxFile", {}).get("filename"),
            "filehash": row.get("vpxFile", {}).get("filehash"),
            "createdAt": row.get("createdAt"),
            "updatedAt": row.get("updatedAt"),
        }
        for row in rows
    ]
    items = enrich_with_vpsdb(response, db)
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


@router.get("/tables/{vpsId}", response_model=List[GlobalTableResponse])
async def get_table(vpsId: str, db: Database = Depends(get_db)):
    """
    Get all table variations by VPSId.

    Returns all unique variations of the table with different VPX file metadata.
    """
    tables = list(db["tables"].find({"vpsId": vpsId}))  # TODO: Collection structure may change

    if not tables:
        return []

    response = [
        {
            "vpsId": table["vpsId"],
            "rom": table.get("rom"),
            "vpxFile": table["vpxFile"],
            "createdAt": table.get("createdAt", table.get("updatedAt")),
            "updatedAt": table["updatedAt"],
            "lastSeenAt": table["lastSeenAt"],
        }
        for table in tables
    ]

    return enrich_with_vpsdb(response, db)


@router.get("/vpsdb/status")
async def get_vpsdb_status(db: Database = Depends(get_db)):
    """Return cached VPS DB sync status (no forced refresh)."""
    return get_vpsdb_sync_status(db)


@router.get("/vpsdb/{vpsId}")
async def get_vpsdb_by_id(vpsId: str, db: Database = Depends(get_db)):
    """Get cached VPS DB selected fields for a vpsId."""
    doc = db["vpsdb_aux"].find_one({"_id": vpsId}, {"_id": 0, "vpsId": 1, "data": 1, "updatedAt": 1})
    if not doc:
        return {"vpsId": vpsId, "vpsdb": None}
    return {
        "vpsId": doc["vpsId"],
        "vpsdb": doc.get("data", {}),
        "updatedAt": doc.get("updatedAt"),
    }
