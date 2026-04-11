from datetime import UTC, datetime
from typing import Any

from pymongo import DeleteOne, ReplaceOne
from pymongo.database import Database

TABLES_PLUS_CACHE_COLLECTION = "tables_plus_cache"


def _normalize_vps_ids(vps_ids: list[str] | None) -> list[str] | None:
    if vps_ids is None:
        return None
    unique_ids = sorted(
        {
            str(vps_id).strip()
            for vps_id in vps_ids
            if vps_id is not None and str(vps_id).strip()
        }
    )
    return unique_ids


def _build_vpsid_match(vps_ids: list[str] | None) -> dict[str, Any]:
    if vps_ids is None:
        return {}
    return {"vpsId": {"$in": vps_ids}}


def _coerce_year_value(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _aggregate_variation_stats(db: Database, vps_ids: list[str] | None) -> dict[str, dict[str, Any]]:
    pipeline: list[dict[str, Any]] = []
    match_stage = _build_vpsid_match(vps_ids)
    if match_stage:
        pipeline.append({"$match": match_stage})
    pipeline.append(
        {
            "$group": {
                "_id": "$vpsId",
                "firstSeenAt": {"$min": {"$ifNull": ["$createdAt", "$updatedAt"]}},
                "variationCount": {"$sum": 1},
            }
        }
    )
    return {
        row["_id"]: {
            "firstSeenAt": row.get("firstSeenAt"),
            "variationCount": int(row.get("variationCount") or 0),
        }
        for row in db["tables"].aggregate(pipeline)
        if row.get("_id")
    }


def _aggregate_rating_stats(db: Database, vps_ids: list[str] | None) -> dict[str, dict[str, Any]]:
    match_stage: dict[str, Any] = {"rating": {"$gte": 1, "$lte": 5}}
    if vps_ids is not None:
        match_stage["vpsId"] = {"$in": vps_ids}

    pipeline = [
        {"$match": match_stage},
        {
            "$group": {
                "_id": "$vpsId",
                "avgRating": {"$avg": "$rating"},
                "ratingCount": {"$sum": 1},
            }
        },
    ]

    return {
        row["_id"]: {
            "avgRating": round(float(row.get("avgRating") or 0), 3),
            "ratingCount": int(row.get("ratingCount") or 0),
        }
        for row in db["user_table_ratings"].aggregate(pipeline)
        if row.get("_id")
    }


def _aggregate_state_stats(db: Database, vps_ids: list[str] | None) -> dict[str, dict[str, Any]]:
    pipeline: list[dict[str, Any]] = []
    match_stage = _build_vpsid_match(vps_ids)
    if match_stage:
        pipeline.append({"$match": match_stage})
    pipeline.append(
        {
            "$group": {
                "_id": "$vpsId",
                "runTimeTotal": {"$sum": {"$ifNull": ["$runTime", 0]}},
                "startCountTotal": {"$sum": {"$ifNull": ["$startCount", 0]}},
                "playerCount": {"$sum": 1},
                "lastSeenAt": {"$max": "$lastSeenAt"},
                "lastRun": {"$max": "$lastRun"},
            }
        }
    )
    return {
        row["_id"]: {
            "runTimeTotal": int(row.get("runTimeTotal") or 0),
            "startCountTotal": int(row.get("startCountTotal") or 0),
            "playerCount": int(row.get("playerCount") or 0),
            "lastSeenAt": row.get("lastSeenAt"),
            "lastRun": row.get("lastRun"),
        }
        for row in db["user_table_state"].aggregate(pipeline)
        if row.get("_id")
    }


def _load_vpsdb_docs(db: Database, vps_ids: list[str] | None) -> dict[str, dict[str, Any]]:
    query = {"_id": {"$in": vps_ids}} if vps_ids is not None else {}
    cursor = db["vpsdb_aux"].find(query, {"_id": 1, "data": 1})
    return {
        doc["_id"]: (doc.get("data") or {})
        for doc in cursor
        if doc.get("_id")
    }


def rebuild_tables_plus_cache(db: Database, vps_ids: list[str] | None = None) -> dict[str, int]:
    """
    Rebuild flattened table-search cache documents keyed by vpsId.

    When `vps_ids` is provided, only those cache entries are refreshed.
    Otherwise, the entire cache is rebuilt from source collections.
    """
    normalized_vps_ids = _normalize_vps_ids(vps_ids)
    variation_stats = _aggregate_variation_stats(db, normalized_vps_ids)
    rating_stats = _aggregate_rating_stats(db, normalized_vps_ids)
    state_stats = _aggregate_state_stats(db, normalized_vps_ids)
    vpsdb_docs = _load_vpsdb_docs(db, normalized_vps_ids)

    target_vps_ids = normalized_vps_ids or sorted(variation_stats.keys())
    now = datetime.now(UTC)

    if not target_vps_ids and normalized_vps_ids is None:
        db[TABLES_PLUS_CACHE_COLLECTION].delete_many({})
        return {"upserted": 0, "deleted": 0}

    ops: list[ReplaceOne | DeleteOne] = []
    upserted = 0
    deleted = 0

    for vps_id in target_vps_ids:
        variation_data = variation_stats.get(vps_id)
        if not variation_data:
            ops.append(DeleteOne({"_id": vps_id}))
            deleted += 1
            continue

        vpsdb_data = vpsdb_docs.get(vps_id, {})
        authors = vpsdb_data.get("authors")
        first_author = authors[0] if isinstance(authors, list) and authors else ""

        doc = {
            "_id": vps_id,
            "vpsId": vps_id,
            "name": str(vpsdb_data.get("name") or ""),
            "manufacturer": str(vpsdb_data.get("manufacturer") or ""),
            "year": _coerce_year_value(vpsdb_data.get("year")),
            "authors": first_author,
            "firstAuthor": first_author,
            "sortName": str(vpsdb_data.get("name") or "").lower(),
            "avgRating": float((rating_stats.get(vps_id) or {}).get("avgRating") or 0),
            "ratingCount": int((rating_stats.get(vps_id) or {}).get("ratingCount") or 0),
            "playerCount": int((state_stats.get(vps_id) or {}).get("playerCount") or 0),
            "startCountTotal": int((state_stats.get(vps_id) or {}).get("startCountTotal") or 0),
            "runTimeTotal": int((state_stats.get(vps_id) or {}).get("runTimeTotal") or 0),
            "lastSeenAt": (state_stats.get(vps_id) or {}).get("lastSeenAt"),
            "lastRun": (state_stats.get(vps_id) or {}).get("lastRun"),
            "variationCount": int(variation_data.get("variationCount") or 0),
            "firstSeenAt": variation_data.get("firstSeenAt"),
            "cacheUpdatedAt": now,
        }

        ops.append(ReplaceOne({"_id": vps_id}, doc, upsert=True))
        upserted += 1

    if ops:
        db[TABLES_PLUS_CACHE_COLLECTION].bulk_write(ops, ordered=False)

    if normalized_vps_ids is None:
        db[TABLES_PLUS_CACHE_COLLECTION].delete_many({"_id": {"$nin": target_vps_ids}})

    return {"upserted": upserted, "deleted": deleted}
