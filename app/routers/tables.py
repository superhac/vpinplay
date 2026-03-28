import json
import re

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
    offset: int = Query(0, ge=0),
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
        {"$skip": offset},
        {"$limit": limit}
    ]

    results = list(db["user_table_ratings"].aggregate(pipeline))

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

    results = list(db["user_table_ratings"].aggregate(pipeline))
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


@router.get("/tables/{vpsId}/cumulative-rating")
async def get_global_table_cumulative_rating(vpsId: str, db: Database = Depends(get_db)):
    """
    Get cumulative average rating for a specific table across all users.
    Returns `cumulativeRating` plus `ratingCount`.
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

    results = list(db["user_table_ratings"].aggregate(pipeline))
    if not results:
        response = [{
            "vpsId": vpsId,
            "cumulativeRating": None,
            "ratingCount": 0,
        }]
        return enrich_with_vpsdb(response, db)[0]

    row = results[0]
    response = [{
        "vpsId": row["_id"],
        "cumulativeRating": round(float(row["avgRating"]), 3),
        "ratingCount": int(row["ratingCount"]),
    }]
    return enrich_with_vpsdb(response, db)[0]


@router.get("/tables/{vpsId}/user-ratings")
async def get_table_user_ratings(vpsId: str, db: Database = Depends(get_db)):
    """
    Get player ratings for a table (one row per user).
    """
    rows = list(
        db["user_table_state"]
        .find(
            {
                "vpsId": vpsId,
                "rating": {"$gte": 1, "$lte": 5},
            },
            {
                "_id": 0,
                "userId": 1,
                "rating": 1,
                "lastRun": 1,
                "updatedAt": 1,
            },
        )
        .sort([("rating", -1), ("userId", 1)])
    )

    return [
        {
            "userId": row.get("userId"),
            "rating": row.get("rating"),
            "lastRun": row.get("lastRun"),
            "updatedAt": row.get("updatedAt"),
        }
        for row in rows
    ]


@router.get("/tables/newly-added")
async def get_global_new_tables(
    limit: int = Query(100, ge=1, le=100),
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
    offset: int = Query(0, ge=0),
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
        {"$skip": offset},
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
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get top tables by number of known variants (highest first).
    """
    pipeline = [
        {"$group": {"_id": "$vpsId", "variationCount": {"$sum": 1}}},
        {"$sort": {"variationCount": -1, "_id": 1}},
        {"$skip": offset},
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


@router.get("/tables/count")
async def get_table_counts(db: Database = Depends(get_db)):
    """
    Get total table counts.

    - totalTableRows: total rows in `tables` collection (all variations)
    - uniqueVpsIdCount: total distinct VPS IDs
    """
    total_rows = db["tables"].count_documents({})
    unique_vps_ids = len(db["tables"].distinct("vpsId"))
    return {
        "totalTableRows": int(total_rows),
        "uniqueVpsIdCount": int(unique_vps_ids),
    }


@router.get("/tables")
async def get_all_tables(
    limit: int = Query(50, ge=1, le=100),
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


@router.get("/tables/by-rom/{rom}")
async def get_tables_by_rom(
    rom: str,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Find table variation rows by ROM name (case-insensitive exact match).
    """
    clean_rom = rom.strip()
    if clean_rom == "":
        return {
            "items": [],
            "pagination": {
                "limit": limit,
                "offset": offset,
                "returned": 0,
                "total": 0,
                "hasNext": False,
                "hasPrev": offset > 0,
            },
        }

    rom_filter = {
        "$or": [
            {"rom": {"$regex": f"^{re.escape(clean_rom)}$", "$options": "i"}},
            {"vpxFile.rom": {"$regex": f"^{re.escape(clean_rom)}$", "$options": "i"}},
        ]
    }
    total = db["tables"].count_documents(rom_filter)
    pipeline = [
        {"$match": rom_filter},
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
                "rom": 1,
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
            "rom": row.get("rom") or row.get("vpxFile", {}).get("rom"),
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


@router.get("/tables/by-filehash/{filehash}")
async def get_vpsid_by_filehash(filehash: str, db: Database = Depends(get_db)):
    """
    Resolve a VPS ID by VPX file hash (`vpxFile.filehash`).
    Also returns `altvpsid` when present on any matching table variation.
    """
    clean_hash = filehash.strip()
    if clean_hash == "":
        return {"filehash": filehash, "vpsId": None, "altvpsid": None}

    matching_tables = list(
        db["tables"]
        .find({"vpxFile.filehash": clean_hash}, {"_id": 0, "vpsId": 1, "updatedAt": 1, "vpxFile": 1})
        .sort("updatedAt", -1)
    )
    if not matching_tables:
        return {"filehash": clean_hash, "vpsId": None, "altvpsid": None}

    matched_vps_ids = [row.get("vpsId") for row in matching_tables if row.get("vpsId")]
    vpx_signatures = [
        json.dumps(row["vpxFile"], sort_keys=True, separators=(",", ":"))
        for row in matching_tables
        if isinstance(row.get("vpxFile"), dict)
    ]

    altvpsid = None

    # Prefer variation-level altvpsid rows tied to matching VPX signatures.
    if matched_vps_ids and vpx_signatures:
        rating_rows = (
            db["user_table_ratings"]
            .find(
                {
                    "vpsId": {"$in": matched_vps_ids},
                    "vpxFileSignature": {"$in": vpx_signatures},
                },
                {"_id": 0, "altvpsid": 1, "updatedAt": 1},
            )
            .sort("updatedAt", -1)
            .limit(50)
        )
        for row in rating_rows:
            value = row.get("altvpsid")
            if isinstance(value, str) and value.strip():
                altvpsid = value
                break

    # Fallback for older data paths where altvpsid only exists in user table state.
    if altvpsid is None and matched_vps_ids:
        state_rows = (
            db["user_table_state"]
            .find(
                {"vpsId": {"$in": matched_vps_ids}},
                {"_id": 0, "altvpsid": 1, "updatedAt": 1},
            )
            .sort("updatedAt", -1)
            .limit(50)
        )
        for row in state_rows:
            value = row.get("altvpsid")
            if isinstance(value, str) and value.strip():
                altvpsid = value
                break

    return {
        "filehash": clean_hash,
        "vpsId": matching_tables[0].get("vpsId"),
        "altvpsid": altvpsid,
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

    def has_text(value):
        return isinstance(value, str) and value.strip() != ""

    # Build per-variation alt metadata map from latest submitted per-variation rows.
    variation_alt_map: dict[str, dict[str, str | None]] = {}
    rating_rows = db["user_table_ratings"].find(
        {"vpsId": vpsId},
        {
            "_id": 0,
            "vpxFileSignature": 1,
            "alttitle": 1,
            "altvpsid": 1,
            "updatedAt": 1,
        },
    ).sort("updatedAt", -1)

    for row in rating_rows:
        signature = row.get("vpxFileSignature")
        if not signature:
            continue
        current = variation_alt_map.setdefault(signature, {"alttitle": None, "altvpsid": None})
        if current["alttitle"] is None and has_text(row.get("alttitle")):
            current["alttitle"] = row.get("alttitle")
        if current["altvpsid"] is None and has_text(row.get("altvpsid")):
            current["altvpsid"] = row.get("altvpsid")

    response = [
        {
            "vpsId": table["vpsId"],
            "rom": table.get("rom"),
            "vpxFile": table["vpxFile"],
            "submittedByUserIdsNormalized": table.get("submittedByUserIdsNormalized", []),
            "firstSeenByUserIdNormalized": table.get("firstSeenByUserIdNormalized"),
            "alttitle": variation_alt_map.get(
                json.dumps(table["vpxFile"], sort_keys=True, separators=(",", ":")),
                {},
            ).get("alttitle"),
            "altvpsid": variation_alt_map.get(
                json.dumps(table["vpxFile"], sort_keys=True, separators=(",", ":")),
                {},
            ).get("altvpsid"),
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
