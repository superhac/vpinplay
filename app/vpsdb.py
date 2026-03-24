import asyncio
import logging
import os
from datetime import datetime, UTC
from typing import Any

import requests
from pymongo import UpdateOne
from pymongo.database import Database

logger = logging.getLogger(__name__)

VPSDB_URL = os.getenv(
    "VPSDB_URL",
    "https://github.com/VirtualPinballSpreadsheet/vps-db/raw/refs/heads/main/db/vpsdb.json",
)
VPSDB_SYNC_INTERVAL_SECONDS = int(os.getenv("VPSDB_SYNC_INTERVAL_SECONDS", "3600"))
VPSDB_REQUIRED_FIELDS = ["name", "authors", "manufacturer", "year"]
VPSDB_CONFIGURED_FIELDS = [
    field.strip()
    for field in os.getenv("VPSDB_SELECTED_FIELDS", ",".join(VPSDB_REQUIRED_FIELDS)).split(",")
    if field.strip()
]
VPSDB_SELECTED_FIELDS = list(dict.fromkeys(VPSDB_REQUIRED_FIELDS + VPSDB_CONFIGURED_FIELDS))

VPSDB_COLLECTION = "vpsdb_aux"
VPSDB_META_COLLECTION = "vpsdb_sync_meta"


def _normalize_payload_by_vpsid(payload: Any) -> dict[str, dict[str, Any]]:
    """
    Normalize VPS DB payload into a mapping keyed by canonical vpsId.

    Supported source shapes:
    - dict keyed directly by vpsId
    - list of objects with id/vpsId/vpsid
    """
    if isinstance(payload, dict):
        normalized: dict[str, dict[str, Any]] = {}
        for vps_id, record in payload.items():
            if isinstance(record, dict):
                normalized[str(vps_id)] = record
        return normalized

    if isinstance(payload, list):
        normalized = {}
        for record in payload:
            if not isinstance(record, dict):
                continue
            vps_id = record.get("vpsId") or record.get("vpsid") or record.get("id")
            if not vps_id:
                continue
            normalized[str(vps_id)] = record
        return normalized

    raise ValueError(f"Unsupported VPSDB payload type: {type(payload).__name__}")


def _resolve_selected_field(source: dict[str, Any], field: str) -> Any:
    # Direct key lookup first.
    if field in source:
        return source.get(field)

    # Allow optional dotted path lookups for future flexibility.
    if "." in field:
        current: Any = source
        for part in field.split("."):
            if not isinstance(current, dict):
                return None
            current = current.get(part)
            if current is None:
                return None
        return current

    # Compatibility alias: many VPS entries use "designers" where callers expect authors.
    if field == "authors":
        return source.get("authors") or source.get("designers")

    return None


def _extract_selected_fields(source: dict[str, Any], selected_fields: list[str]) -> dict[str, Any]:
    return {field: _resolve_selected_field(source, field) for field in selected_fields}


def sync_vpsdb_snapshot(db: Database) -> dict[str, Any]:
    """Fetch VPS DB JSON and upsert selected fields into MongoDB."""
    started_at = datetime.now(UTC)

    response = requests.get(VPSDB_URL, timeout=60)
    response.raise_for_status()
    payload = response.json()
    records_by_vpsid = _normalize_payload_by_vpsid(payload)

    ops: list[UpdateOne] = []
    now = datetime.now(UTC)
    for vps_id, record in records_by_vpsid.items():
        selected_data = _extract_selected_fields(record, VPSDB_SELECTED_FIELDS)
        ops.append(
            UpdateOne(
                {"_id": vps_id},
                {
                    "$set": {
                        "vpsId": vps_id,
                        "data": selected_data,
                        "updatedAt": now,
                    },
                    "$setOnInsert": {"createdAt": now},
                },
                upsert=True,
            )
        )

    if not ops:
        raise ValueError("VPSDB payload did not contain any usable records")

    db[VPSDB_COLLECTION].bulk_write(ops, ordered=False)

    finished_at = datetime.now(UTC)
    db[VPSDB_META_COLLECTION].update_one(
        {"_id": "vpsdb"},
        {
            "$set": {
                "lastSyncStartedAt": started_at,
                "lastSyncAt": finished_at,
                "recordCount": len(ops),
                "selectedFields": VPSDB_SELECTED_FIELDS,
                "url": VPSDB_URL,
                "syncIntervalSeconds": VPSDB_SYNC_INTERVAL_SECONDS,
                "status": "ok",
            }
        },
        upsert=True,
    )

    return {
        "lastSyncAt": finished_at,
        "recordCount": len(ops),
        "selectedFields": VPSDB_SELECTED_FIELDS,
    }


async def vpsdb_sync_loop(db: Database, stop_event: asyncio.Event):
    """Run VPS DB sync on startup and every configured interval."""
    while not stop_event.is_set():
        try:
            result = await asyncio.to_thread(sync_vpsdb_snapshot, db)
            logger.info(
                "VPSDB sync completed: records=%s, fields=%s",
                result["recordCount"],
                result["selectedFields"],
            )
        except Exception as exc:  # pragma: no cover - defensive runtime path
            logger.exception("VPSDB sync failed: %s", exc)
            db[VPSDB_META_COLLECTION].update_one(
                {"_id": "vpsdb"},
                {
                    "$set": {
                        "lastErrorAt": datetime.now(UTC),
                        "lastError": str(exc),
                        "status": "error",
                        "selectedFields": VPSDB_SELECTED_FIELDS,
                        "url": VPSDB_URL,
                        "syncIntervalSeconds": VPSDB_SYNC_INTERVAL_SECONDS,
                    }
                },
                upsert=True,
            )

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=VPSDB_SYNC_INTERVAL_SECONDS)
        except TimeoutError:
            pass


def get_vpsdb_enrichment_map(db: Database, vps_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Return selected VPS DB fields keyed by vpsId for the provided ids."""
    unique_ids = list({vps_id for vps_id in vps_ids if vps_id})
    if not unique_ids:
        return {}

    cursor = db[VPSDB_COLLECTION].find({"_id": {"$in": unique_ids}})
    return {doc["_id"]: doc.get("data", {}) for doc in cursor}


def get_vpsdb_sync_status(db: Database) -> dict[str, Any]:
    status = db[VPSDB_META_COLLECTION].find_one({"_id": "vpsdb"}, {"_id": 0})
    return status or {
        "status": "not_initialized",
        "selectedFields": VPSDB_SELECTED_FIELDS,
        "url": VPSDB_URL,
        "syncIntervalSeconds": VPSDB_SYNC_INTERVAL_SECONDS,
    }
