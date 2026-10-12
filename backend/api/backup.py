import datetime
from fastapi import APIRouter, HTTPException

from ..config import get_data_dir
from ..storage import read_json, write_json

router = APIRouter(prefix="/api/backup", tags=["backup"])

# Files that make up one profile. Exchange rates and the price cache are refetched, so they're left out.
PROFILE_FILES = ["accounts.json", "debts.json", "life_events.json", "settings.json", "projections.json", "alternatives.json"]


@router.get("")
def export_backup() -> dict:
    data_dir = get_data_dir()
    return {
        "app": "finance-tracker",
        "version": 1,
        "exported_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "files": {name: read_json(data_dir / name) for name in PROFILE_FILES if (data_dir / name).exists()},
    }


@router.post("/restore")
def restore_backup(body: dict) -> dict:
    if body.get("app") != "finance-tracker" or not isinstance(body.get("files"), dict):
        raise HTTPException(400, "That file isn't a Finance Tracker backup.")
    data_dir = get_data_dir()
    restored = []
    for name, content in body["files"].items():
        if name not in PROFILE_FILES:
            continue
        write_json(data_dir / name, content)
        restored.append(name)
    return {"restored": restored}
