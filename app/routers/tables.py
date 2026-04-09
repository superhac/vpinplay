import json
import re

from fastapi import APIRouter, Depends, Query
from typing import List, Optional
from datetime import datetime, timedelta
from pymongo.database import Database

from app.dependencies import get_db
from app.models import GlobalTableResponse
from app.response_enrichment import enrich_with_vpsdb
from app.tables_plus_cache import TABLES_PLUS_CACHE_COLLECTION
from app.vpsdb import get_vpsdb_sync_status

router = APIRouter(
    prefix="/api/v1",
    tags=["tables"]
)


def _build_daily_bucket_labels(days: int, end_exclusive: datetime) -> list[str]:
    start_day = (end_exclusive - timedelta(days=days)).date()
    return [
        (start_day + timedelta(days=offset)).isoformat()
        for offset in range(days)
    ]


def _normalize_daily_bucket_points(
    bucket_labels: list[str],
    raw_points: list[dict],
) -> list[dict]:
    point_map = {
        str(point.get("bucket")): {
            "bucket": str(point.get("bucket")),
            "runTimePlayed": int(point.get("runTimePlayed", 0)),
            "startCountPlayed": int(point.get("startCountPlayed", 0)),
        }
        for point in raw_points
        if point.get("bucket")
    }
    return [
        point_map.get(
            bucket,
            {
                "bucket": bucket,
                "runTimePlayed": 0,
                "startCountPlayed": 0,
            },
        )
        for bucket in bucket_labels
    ]


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


@router.get("/tables/latest-submitted-ratings")
async def get_global_latest_submitted_ratings(
    limit: int = Query(5, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get the most recent actual rating submissions/changes across all users.
    """
    rows = list(
        db["user_table_rating_deltas"]
        .find(
            {
                "newRating": {"$gte": 1, "$lte": 5},
                "$expr": {"$ne": ["$prevRating", "$newRating"]},
            },
            {
                "_id": 0,
                "userId": 1,
                "vpsId": 1,
                "prevRating": 1,
                "newRating": 1,
                "changedAt": 1,
            },
        )
        .sort([("changedAt", -1), ("userId", 1), ("vpsId", 1)])
        .skip(offset)
        .limit(limit)
    )

    response = [
        {
            "userId": row.get("userId"),
            "vpsId": row.get("vpsId"),
            "prevRating": row.get("prevRating"),
            "rating": row.get("newRating"),
            "updatedAt": row.get("changedAt"),
        }
        for row in rows
    ]
    return enrich_with_vpsdb(response, db)


@router.get("/tables/top-reviewers")
async def get_global_top_reviewers(
    limit: int = Query(10, ge=1, le=25),
    db: Database = Depends(get_db),
):
    """
    Get top users by count of submitted ratings/reviews.
    """
    pipeline = [
        {"$match": {"rating": {"$gte": 1, "$lte": 5}}},
        {
            "$group": {
                "_id": "$userId",
                "reviewCount": {"$sum": 1},
            }
        },
        {"$sort": {"reviewCount": -1, "_id": 1}},
        {"$limit": limit},
    ]

    rows = list(db["user_table_ratings"].aggregate(pipeline))
    return [
        {
            "userId": row.get("_id"),
            "reviewCount": int(row.get("reviewCount", 0)),
        }
        for row in rows
    ]


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


@router.get("/tables/{vpsId}/top-runtime-players")
async def get_table_top_runtime_players(
    vpsId: str,
    limit: int = Query(5, ge=1, le=100),
    db: Database = Depends(get_db),
):
    """
    Get players for a table ranked by each player's cumulative runTime
    across all tables (highest first).
    Collapses duplicate state rows to one record per normalized user.
    """
    pipeline = [
        {
            "$match": {
                "vpsId": vpsId,
                "runTime": {"$gt": 0},
            }
        },
        {
            "$addFields": {
                "userIdGroup": {
                    "$toLower": {
                        "$ifNull": [
                            "$userIdNormalized",
                            {"$ifNull": ["$userId", ""]},
                        ]
                    }
                }
            }
        },
        {"$sort": {"runTime": -1, "updatedAt": -1, "userId": 1}},
        {
            "$group": {
                "_id": "$userIdGroup",
                "userId": {"$first": "$userId"},
                "lastRun": {"$first": "$lastRun"},
                "updatedAt": {"$first": "$updatedAt"},
            }
        },
        {
            "$lookup": {
                "from": "user_table_state",
                "let": {"userIdGroup": "$_id"},
                "pipeline": [
                    {
                        "$addFields": {
                            "userIdGroup": {
                                "$toLower": {
                                    "$ifNull": [
                                        "$userIdNormalized",
                                        {"$ifNull": ["$userId", ""]},
                                    ]
                                }
                            }
                        }
                    },
                    {"$match": {"$expr": {"$eq": ["$userIdGroup", "$$userIdGroup"]}}},
                    {"$sort": {"runTime": -1, "updatedAt": -1, "vpsId": 1}},
                    {
                        "$group": {
                            "_id": "$vpsId",
                            "runTime": {"$first": {"$ifNull": ["$runTime", 0]}},
                        }
                    },
                    {
                        "$group": {
                            "_id": None,
                            "runTimeTotal": {"$sum": "$runTime"},
                        }
                    },
                ],
                "as": "runtimeTotals",
            }
        },
        {
            "$addFields": {
                "runTime": {
                    "$ifNull": [
                        {"$arrayElemAt": ["$runtimeTotals.runTimeTotal", 0]},
                        0,
                    ]
                }
            }
        },
        {"$sort": {"runTime": -1, "userId": 1}},
        {"$limit": limit},
    ]

    rows = list(db["user_table_state"].aggregate(pipeline))

    return [
        {
            "userId": row.get("userId"),
            "runTime": row.get("runTime"),
            "lastRun": row.get("lastRun"),
            "updatedAt": row.get("updatedAt"),
        }
        for row in rows
    ]


@router.get("/tables/{vpsId}/activity-summary")
async def get_table_activity_summary(vpsId: str, db: Database = Depends(get_db)):
    """
    Get cumulative runTime and startCount totals for one table across all users.
    Collapses duplicate state rows to one record per normalized user.
    """
    pipeline = [
        {"$match": {"vpsId": vpsId}},
        {
            "$addFields": {
                "userIdGroup": {
                    "$toLower": {
                        "$ifNull": [
                            "$userIdNormalized",
                            {"$ifNull": ["$userId", ""]},
                        ]
                    }
                }
            }
        },
        {"$sort": {"runTime": -1, "startCount": -1, "updatedAt": -1, "userId": 1}},
        {
            "$group": {
                "_id": "$userIdGroup",
                "userId": {"$first": "$userId"},
                "runTime": {"$first": {"$ifNull": ["$runTime", 0]}},
                "startCount": {"$first": {"$ifNull": ["$startCount", 0]}},
            }
        },
        {
            "$group": {
                "_id": vpsId,
                "runTimeTotal": {"$sum": "$runTime"},
                "startCountTotal": {"$sum": "$startCount"},
                "playerCount": {"$sum": 1},
            }
        }
    ]

    results = list(db["user_table_state"].aggregate(pipeline))
    if not results:
        response = [{
            "vpsId": vpsId,
            "runTimeTotal": 0,
            "startCountTotal": 0,
            "playerCount": 0,
        }]
        return enrich_with_vpsdb(response, db)[0]

    row = results[0]
    response = [{
        "vpsId": row["_id"],
        "runTimeTotal": int(row.get("runTimeTotal", 0)),
        "startCountTotal": int(row.get("startCountTotal", 0)),
        "playerCount": int(row.get("playerCount", 0)),
    }]
    return enrich_with_vpsdb(response, db)[0]


@router.get("/tables/{vpsId}/activity-weekly")
async def get_table_activity_weekly(
    vpsId: str,
    days: int = Query(7, ge=1, le=365),
    db: Database = Depends(get_db)
):
    """
    Get cumulative runTime and startCount deltas for one table over the trailing N days.
    Only positive deltas are counted.
    """
    now = datetime.utcnow()
    since = now - timedelta(days=days)

    pipeline = [
        {
            "$match": {
                "$and": [
                    {"vpsId": vpsId},
                    {"changedAt": {"$gte": since}},
                ]
            }
        },
        {
            "$group": {
                "_id": "$vpsId",
                "runTimePlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaRunTime", 0]},
                            "$deltaRunTime",
                            0,
                        ]
                    }
                },
                "startCountPlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaStartCount", 0]},
                            "$deltaStartCount",
                            0,
                        ]
                    }
                },
                "changeEvents": {"$sum": 1},
            }
        }
    ]

    results = list(db["user_table_state_deltas"].aggregate(pipeline))
    if not results:
        response = [{
            "vpsId": vpsId,
            "days": days,
            "from": since,
            "to": now,
            "runTimePlayed": 0,
            "startCountPlayed": 0,
            "changeEvents": 0,
        }]
        return enrich_with_vpsdb(response, db)[0]

    row = results[0]
    response = [{
        "vpsId": row["_id"],
        "days": days,
        "from": since,
        "to": now,
        "runTimePlayed": int(row.get("runTimePlayed", 0)),
        "startCountPlayed": int(row.get("startCountPlayed", 0)),
        "changeEvents": int(row.get("changeEvents", 0)),
    }]
    return enrich_with_vpsdb(response, db)[0]


@router.get("/tables/{vpsId}/activity-buckets")
async def get_table_activity_buckets(
    vpsId: str,
    days: int = Query(30, ge=1, le=365),
    db: Database = Depends(get_db),
):
    """
    Get daily runtime/start-count buckets for one table over the trailing N days.
    Counts only positive runtime/start-count deltas.
    """
    end_exclusive = datetime.utcnow().replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=1)
    since = end_exclusive - timedelta(days=days)
    bucket_labels = _build_daily_bucket_labels(days, end_exclusive)

    pipeline = [
        {
            "$match": {
                "vpsId": vpsId,
                "changedAt": {"$gte": since, "$lt": end_exclusive},
            }
        },
        {
            "$group": {
                "_id": {
                    "bucket": {
                        "$dateToString": {
                            "format": "%Y-%m-%d",
                            "date": "$changedAt",
                        }
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
                "startCountPlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaStartCount", 0]},
                            "$deltaStartCount",
                            0,
                        ]
                    }
                },
            }
        },
        {"$sort": {"_id.bucket": 1}},
    ]

    rows = list(db["user_table_state_deltas"].aggregate(pipeline))
    daily_buckets = _normalize_daily_bucket_points(
        bucket_labels,
        [
            {
                "bucket": row.get("_id", {}).get("bucket"),
                "runTimePlayed": row.get("runTimePlayed", 0),
                "startCountPlayed": row.get("startCountPlayed", 0),
            }
            for row in rows
        ],
    )
    response = [{
        "vpsId": vpsId,
        "days": days,
        "bucketUnit": "day",
        "from": since,
        "to": end_exclusive,
        "runTimePlayed": sum(point["runTimePlayed"] for point in daily_buckets),
        "startCountPlayed": sum(point["startCountPlayed"] for point in daily_buckets),
        "dailyBuckets": daily_buckets,
    }]
    return enrich_with_vpsdb(response, db)[0]


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


@router.get("/tables/top-newly-added")
async def get_global_top_newly_added_tables(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=25),
    db: Database = Depends(get_db),
):
    """
    Get the newest tables first seen in the trailing N days,
    ranked by first-seen date descending, plus installed player counts.
    """
    end_exclusive = datetime.utcnow().replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=1)
    since = end_exclusive - timedelta(days=days)

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
        {
            "$match": {
                "firstSeenAt": {"$gte": since, "$lt": end_exclusive},
            }
        },
        {"$sort": {"firstSeenAt": -1, "_id": 1}},
        {"$limit": limit},
    ]

    rows = list(db["tables"].aggregate(pipeline))
    vps_ids = [row["_id"] for row in rows if row.get("_id")]

    player_counts = {}
    if vps_ids:
      player_rows = list(
          db["user_table_state"].aggregate([
              {"$match": {"vpsId": {"$in": vps_ids}}},
              {
                  "$group": {
                      "_id": "$vpsId",
                      "distinctUsers": {"$addToSet": "$userId"},
                  }
              },
              {
                  "$project": {
                      "_id": 1,
                      "playerCount": {"$size": "$distinctUsers"},
                  }
              },
          ])
      )
      player_counts = {
          row.get("_id"): int(row.get("playerCount", 0))
          for row in player_rows
      }

    response = [
        {
            "vpsId": row["_id"],
            "firstSeenAt": row.get("firstSeenAt"),
            "variationCount": int(row.get("variationCount", 0)),
            "playerCount": int(player_counts.get(row["_id"], 0)),
        }
        for row in rows
    ]
    items = enrich_with_vpsdb(response, db)

    return {
        "days": days,
        "from": since,
        "to": end_exclusive,
        "items": items,
    }


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


@router.get("/tables/top-play-time-weekly")
async def get_global_top_play_time_tables_weekly(
    days: int = Query(7, ge=1, le=365),
    limit: int = Query(5, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_db)
):
    """
    Get top tables by trailing N-day runtime using per-sync runtime deltas.
    Counts only positive runtime/start-count deltas.
    """
    now = datetime.utcnow()
    since = now - timedelta(days=days)

    pipeline = [
        {"$match": {"changedAt": {"$gte": since}}},
        {
            "$group": {
                "_id": "$vpsId",
                "runTimePlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaRunTime", 0]},
                            "$deltaRunTime",
                            0,
                        ]
                    }
                },
                "startCountPlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaStartCount", 0]},
                            "$deltaStartCount",
                            0,
                        ]
                    }
                },
                "changeEvents": {"$sum": 1},
                "distinctUsers": {"$addToSet": "$userId"},
                "lastChangedAt": {"$max": "$changedAt"},
            }
        },
        {"$match": {"runTimePlayed": {"$gt": 0}}},
        {
            "$project": {
                "_id": 0,
                "vpsId": "$_id",
                "runTimePlayed": 1,
                "startCountPlayed": 1,
                "changeEvents": 1,
                "playerCount": {"$size": "$distinctUsers"},
                "lastChangedAt": 1,
            }
        },
        {"$sort": {"runTimePlayed": -1, "startCountPlayed": -1, "vpsId": 1}},
        {
            "$facet": {
                "items": [
                    {"$skip": offset},
                    {"$limit": limit},
                ],
                "meta": [
                    {"$count": "total"},
                ],
            }
        },
    ]

    result = list(db["user_table_state_deltas"].aggregate(pipeline))
    facet = result[0] if result else {}
    rows = facet.get("items", [])
    meta = facet.get("meta", [])
    total = int(meta[0].get("total", 0)) if meta else 0

    response = [
        {
            "vpsId": row.get("vpsId"),
            "runTimePlayed": int(row.get("runTimePlayed", 0)),
            "startCountPlayed": int(row.get("startCountPlayed", 0)),
            "changeEvents": int(row.get("changeEvents", 0)),
            "playerCount": int(row.get("playerCount", 0)),
            "lastChangedAt": row.get("lastChangedAt"),
        }
        for row in rows
    ]
    items = enrich_with_vpsdb(response, db)

    return {
        "days": days,
        "from": since,
        "to": now,
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


@router.get("/tables/top-play-time-buckets")
async def get_global_top_play_time_table_buckets(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=25),
    db: Database = Depends(get_db),
):
    """
    Get the top tables by trailing N-day runtime with one daily bucket per table.
    Counts only positive runtime/start-count deltas.
    """
    end_exclusive = datetime.utcnow().replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=1)
    since = end_exclusive - timedelta(days=days)
    bucket_labels = _build_daily_bucket_labels(days, end_exclusive)

    pipeline = [
        {"$match": {"changedAt": {"$gte": since, "$lt": end_exclusive}}},
        {
            "$group": {
                "_id": {
                    "vpsId": "$vpsId",
                    "bucket": {
                        "$dateToString": {
                            "format": "%Y-%m-%d",
                            "date": "$changedAt",
                        }
                    },
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
                "startCountPlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaStartCount", 0]},
                            "$deltaStartCount",
                            0,
                        ]
                    }
                },
            }
        },
        {
            "$group": {
                "_id": "$_id.vpsId",
                "runTimePlayed": {"$sum": "$runTimePlayed"},
                "startCountPlayed": {"$sum": "$startCountPlayed"},
                "dailyBuckets": {
                    "$push": {
                        "bucket": "$_id.bucket",
                        "runTimePlayed": "$runTimePlayed",
                        "startCountPlayed": "$startCountPlayed",
                    }
                },
            }
        },
        {"$match": {"runTimePlayed": {"$gt": 0}}},
        {"$sort": {"runTimePlayed": -1, "startCountPlayed": -1, "_id": 1}},
        {"$limit": limit},
    ]

    rows = list(db["user_table_state_deltas"].aggregate(pipeline))
    response = [
        {
            "vpsId": row.get("_id"),
            "runTimePlayed": int(row.get("runTimePlayed", 0)),
            "startCountPlayed": int(row.get("startCountPlayed", 0)),
            "dailyBuckets": _normalize_daily_bucket_points(
                bucket_labels,
                row.get("dailyBuckets", []),
            ),
        }
        for row in rows
    ]
    items = enrich_with_vpsdb(response, db)

    return {
        "days": days,
        "bucketUnit": "day",
        "from": since,
        "to": end_exclusive,
        "buckets": bucket_labels,
        "items": items,
    }


@router.get("/tables/top-starts-buckets")
async def get_global_top_starts_table_buckets(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=25),
    db: Database = Depends(get_db),
):
    """
    Get the top tables by trailing N-day starts with one daily bucket per table.
    Counts only positive runtime/start-count deltas.
    """
    end_exclusive = datetime.utcnow().replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=1)
    since = end_exclusive - timedelta(days=days)
    bucket_labels = _build_daily_bucket_labels(days, end_exclusive)

    pipeline = [
        {"$match": {"changedAt": {"$gte": since, "$lt": end_exclusive}}},
        {
            "$group": {
                "_id": {
                    "vpsId": "$vpsId",
                    "bucket": {
                        "$dateToString": {
                            "format": "%Y-%m-%d",
                            "date": "$changedAt",
                        }
                    },
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
                "startCountPlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaStartCount", 0]},
                            "$deltaStartCount",
                            0,
                        ]
                    }
                },
            }
        },
        {
            "$group": {
                "_id": "$_id.vpsId",
                "runTimePlayed": {"$sum": "$runTimePlayed"},
                "startCountPlayed": {"$sum": "$startCountPlayed"},
                "dailyBuckets": {
                    "$push": {
                        "bucket": "$_id.bucket",
                        "runTimePlayed": "$runTimePlayed",
                        "startCountPlayed": "$startCountPlayed",
                    }
                },
            }
        },
        {"$match": {"startCountPlayed": {"$gt": 0}}},
        {"$sort": {"startCountPlayed": -1, "runTimePlayed": -1, "_id": 1}},
        {"$limit": limit},
    ]

    rows = list(db["user_table_state_deltas"].aggregate(pipeline))
    response = [
        {
            "vpsId": row.get("_id"),
            "runTimePlayed": int(row.get("runTimePlayed", 0)),
            "startCountPlayed": int(row.get("startCountPlayed", 0)),
            "dailyBuckets": _normalize_daily_bucket_points(
                bucket_labels,
                row.get("dailyBuckets", []),
            ),
        }
        for row in rows
    ]
    items = enrich_with_vpsdb(response, db)

    return {
        "days": days,
        "bucketUnit": "day",
        "from": since,
        "to": end_exclusive,
        "buckets": bucket_labels,
        "items": items,
    }


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


@router.get("/tables/activity-buckets")
async def get_global_activity_buckets(
    days: int = Query(30, ge=1, le=365),
    db: Database = Depends(get_db),
):
    """
    Get global daily runtime/start-count buckets over the trailing N days.
    Counts only positive runtime/start-count deltas.
    """
    end_exclusive = datetime.utcnow().replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=1)
    since = end_exclusive - timedelta(days=days)
    bucket_labels = _build_daily_bucket_labels(days, end_exclusive)

    pipeline = [
        {"$match": {"changedAt": {"$gte": since, "$lt": end_exclusive}}},
        {
            "$group": {
                "_id": {
                    "bucket": {
                        "$dateToString": {
                            "format": "%Y-%m-%d",
                            "date": "$changedAt",
                        }
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
                "startCountPlayed": {
                    "$sum": {
                        "$cond": [
                            {"$gt": ["$deltaStartCount", 0]},
                            "$deltaStartCount",
                            0,
                        ]
                    }
                },
                "changeEvents": {"$sum": 1},
                "distinctUsers": {"$addToSet": "$userId"},
                "distinctTables": {"$addToSet": "$vpsId"},
            }
        },
        {"$sort": {"_id.bucket": 1}},
    ]

    rows = list(db["user_table_state_deltas"].aggregate(pipeline))
    daily_buckets = _normalize_daily_bucket_points(
        bucket_labels,
        [
            {
                "bucket": row.get("_id", {}).get("bucket"),
                "runTimePlayed": row.get("runTimePlayed", 0),
                "startCountPlayed": row.get("startCountPlayed", 0),
            }
            for row in rows
        ],
    )

    change_events = int(sum(int(row.get("changeEvents", 0)) for row in rows))
    user_ids = {
        str(user_id)
        for row in rows
        for user_id in row.get("distinctUsers", [])
        if user_id is not None
    }
    table_ids = {
        str(vps_id)
        for row in rows
        for vps_id in row.get("distinctTables", [])
        if vps_id is not None
    }

    return {
        "days": days,
        "bucketUnit": "day",
        "from": since,
        "to": end_exclusive,
        "runTimePlayed": sum(point["runTimePlayed"] for point in daily_buckets),
        "startCountPlayed": sum(point["startCountPlayed"] for point in daily_buckets),
        "changeEvents": change_events,
        "userCount": len(user_ids),
        "tableCount": len(table_ids),
        "dailyBuckets": daily_buckets,
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


@router.get("/vpsdb/search")
async def search_vpsdb_by_name(
    q: str = Query("", min_length=0),
    limit: int = Query(20, ge=1, le=100),
    db: Database = Depends(get_db),
):
    """
    Search cached VPS DB rows by table name.
    """
    query_text = q.strip()
    if query_text == "":
        return {
            "query": query_text,
            "items": [],
            "limit": limit,
        }

    name_filter = {"data.name": {"$regex": re.escape(query_text), "$options": "i"}}
    rows = list(
        db["vpsdb_aux"]
        .find(
            name_filter,
            {
                "_id": 0,
                "vpsId": 1,
                "data.name": 1,
                "data.manufacturer": 1,
                "data.year": 1,
                "updatedAt": 1,
            },
        )
        .sort([("data.name", 1), ("vpsId", 1)])
        .limit(limit)
    )

    items = [
        {
            "vpsId": row.get("vpsId"),
            "name": ((row.get("data") or {}).get("name")),
            "manufacturer": ((row.get("data") or {}).get("manufacturer")),
            "year": ((row.get("data") or {}).get("year")),
            "updatedAt": row.get("updatedAt"),
        }
        for row in rows
        if row.get("vpsId") and ((row.get("data") or {}).get("name"))
    ]

    return {
        "query": query_text,
        "items": items,
        "limit": limit,
    }


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

@router.get("/tables-plus/search")
async def get_tables_plus_search(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    sort_by: Optional[str] = Query("name"),
    sort_order: Optional[int] = Query(-1, ge=-1, le=1),
    search_key: Optional[str] = Query(None),
    search_term: Optional[str] = Query(None),
    db: Database = Depends(get_db),
):
    """
    Search and sort across all tables with combined statistics and metadata.
    Combines: top rated, play time, variants, and newly added stats.
    """
    
    sort_key_map = {
        "name": "sortName",
        "manufacturer": "manufacturer",
        "year": "year",
        "avgRating": "avgRating",
        "ratingCount": "ratingCount",
        "playerCount": "playerCount",
        "startCountTotal": "startCountTotal",
        "runTimeTotal": "runTimeTotal",
        "variationCount": "variationCount",
        "firstSeenAt": "firstSeenAt",
        "authors": "firstAuthor",
        "vpsId": "vpsId",
    }
    actual_sort_by = sort_key_map.get(sort_by, "sortName")

    match_stage: dict[str, object] = {}
    if search_key and search_term:
        field_map = {
            "name": ("name", "string"),
            "manufacturer": ("manufacturer", "string"),
            "year": ("year", "number"),
            "avgRating": ("avgRating", "number"),
            "ratingCount": ("ratingCount", "number"),
            "playerCount": ("playerCount", "number"),
            "startCountTotal": ("startCountTotal", "number"),
            "runTimeTotal": ("runTimeTotal", "number"),
            "variationCount": ("variationCount", "number"),
            "vpsId": ("vpsId", "string"),
            "authors": ("firstAuthor", "string"),
            }


        field_info = field_map.get(search_key)
        if field_info:
            field_path, field_type = field_info
            if field_type == "string":
                match_stage[field_path] = {"$regex": search_term, "$options": "i"}
            elif field_type == "number":
                match_stage["$expr"] = {
                    "$regexMatch": {
                        "input": { "$toString": f"${field_path}" },
                        "regex": search_term,
                        "options": "i"
                    }
                }

    if match_stage:
        filtered_total = db[TABLES_PLUS_CACHE_COLLECTION].count_documents(match_stage)
    else:
        filtered_total = db[TABLES_PLUS_CACHE_COLLECTION].count_documents({})

    sort_stage = {actual_sort_by: sort_order}

    if actual_sort_by != "avgRating":
        sort_stage["avgRating"] = -1
    if actual_sort_by != "ratingCount":
        sort_stage["ratingCount"] = -1
    if actual_sort_by != "sortName":
        sort_stage["sortName"] = 1
    if actual_sort_by != "vpsId":
        sort_stage["vpsId"] = 1

    items = list(
        db[TABLES_PLUS_CACHE_COLLECTION]
        .find(
            match_stage,
            {
                "_id": 0,
                "name": 1,
                "manufacturer": 1,
                "year": 1,
                "authors": 1,
                "avgRating": 1,
                "ratingCount": 1,
                "playerCount": 1,
                "startCountTotal": 1,
                "runTimeTotal": 1,
                "variationCount": 1,
                "vpsId": 1,
                "firstSeenAt": 1,
                "sortName": 1,
            },
        )
        .sort(list(sort_stage.items()))
        .skip(offset)
        .limit(limit)
    )

    for item in items:
        item.pop("sortName", None)

    return {
        "items": items,
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": filtered_total,
            "hasNext": (offset + len(items)) < filtered_total,
            "hasPrev": offset > 0,
            "sort_by": sort_by,
            "sort_order": sort_order,
        },
    }
