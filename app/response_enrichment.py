from typing import Any

from pymongo.database import Database

from app.vpsdb import get_vpsdb_enrichment_map


def enrich_with_vpsdb(rows: list[dict[str, Any]], db: Database, vpsid_key: str = "vpsId") -> list[dict[str, Any]]:
    """Attach VPSDB selected fields to each row under the `vpsdb` key."""
    vps_ids = [row.get(vpsid_key) for row in rows if row.get(vpsid_key)]
    enrichment_map = get_vpsdb_enrichment_map(db, vps_ids)

    for row in rows:
        vps_id = row.get(vpsid_key)
        row["vpsdb"] = enrichment_map.get(vps_id)

    return rows
