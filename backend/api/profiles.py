import json
import shutil
import uuid
import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..config import get_data_dir, set_data_dir, settings
from ..storage import read_json, write_json

router = APIRouter(prefix="/api/profiles", tags=["profiles"])

# Capture the root data directory once (before any profile switching).
# This is the path configured via DATA_DIR env var or the default.
_ROOT: Path | None = None


def _root() -> Path:
    global _ROOT
    if _ROOT is None:
        _ROOT = Path(settings.data_dir)
    return _ROOT


def _meta_path() -> Path:
    return _root() / "profiles.json"


def _profile_dir(pid: str) -> Path:
    """Returns the data directory for a given profile id."""
    if pid == "default":
        return _root()
    return _root() / "profiles" / pid


def _read_meta() -> dict:
    raw = read_json(_meta_path())
    if not raw or not raw.get("profiles"):
        # First run: treat the existing data/ directory as the default profile
        return {
            "profiles": [{
                "id": "default",
                "name": "My Profile",
                "created": datetime.datetime.now().isoformat(),
            }],
            "active_id": "default",
        }
    return raw


def _write_meta(meta: dict) -> None:
    write_json(_meta_path(), meta)


def _seed_profile(data_dir: Path) -> None:
    """Write empty JSON seed files into a brand-new profile directory."""
    data_dir.mkdir(parents=True, exist_ok=True)
    seeds: dict[str, object] = {
        "accounts.json":       {"accounts": []},
        "debts.json":          {"debts": []},
        "settings.json": {
            "display_currency": "USD",
            "retirement_target": 0,
            "onboarded": False,
            "risk_profiles": {
                "brokerage":     {"profile": "aggressive",      "expected_return": 0.08},
                "isa":           {"profile": "aggressive",      "expected_return": 0.08},
                "401k":          {"profile": "moderate",        "expected_return": 0.07},
                "roth_ira":      {"profile": "moderate",        "expected_return": 0.07},
                "pension":       {"profile": "moderate",        "expected_return": 0.065},
                "crypto":        {"profile": "very_aggressive", "expected_return": 0.15},
                "property":      {"profile": "conservative",    "expected_return": 0.04},
                "cash":          {"profile": "conservative",    "expected_return": 0.045},
                "company_stock": {"profile": "aggressive",      "expected_return": 0.09},
                "alternative":   {"profile": "moderate",        "expected_return": 0.075},
                "other":         {"profile": "moderate",        "expected_return": 0.07},
            },
        },
        "life_events.json":    {"events": []},
        "projections.json":    {"categories": [], "retirement_target": 0},
        "exchange_rates.json": {"base": "USD", "rates": {}, "updated": None},
        "market_cache.json":   {"stocks": {}, "crypto": {}},
    }
    for filename, content in seeds.items():
        path = data_dir / filename
        if not path.exists():
            path.write_text(json.dumps(content, indent=2))


def init_active_profile() -> None:
    """
    Called once at backend startup. Reads profiles.json and restores the
    last-active profile's data directory into the global settings.
    Must be called after the root data_dir exists on disk.
    """
    _root()  # lock in _ROOT from current settings.data_dir
    meta = _read_meta()
    active_id = meta.get("active_id", "default")
    if active_id and active_id != "default":
        profile = next((p for p in meta.get("profiles", []) if p["id"] == active_id), None)
        if profile:
            target = _profile_dir(active_id)
            if target.exists():
                set_data_dir(target)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_profiles() -> dict:
    meta = _read_meta()
    # Attach the resolved data_dir to each profile for the combined-forecast feature
    profiles_out = []
    for p in meta.get("profiles", []):
        out = dict(p)
        out["data_dir"] = str(_profile_dir(p["id"]))
        profiles_out.append(out)
    return {
        "profiles":  profiles_out,
        "active_id": meta.get("active_id", "default"),
    }


@router.post("")
def create_profile(body: dict) -> dict:
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Profile name is required")
    pid = f"profile_{uuid.uuid4().hex[:8]}"
    data_dir = _profile_dir(pid)
    _seed_profile(data_dir)
    profile = {
        "id":      pid,
        "name":    name,
        "created": datetime.datetime.now().isoformat(),
    }
    meta = _read_meta()
    meta.setdefault("profiles", []).append(profile)
    _write_meta(meta)
    profile["data_dir"] = str(data_dir)
    return profile


@router.patch("/{pid}")
def rename_profile(pid: str, body: dict) -> dict:
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Profile name is required")
    meta = _read_meta()
    profile = next((p for p in meta.get("profiles", []) if p["id"] == pid), None)
    if not profile:
        raise HTTPException(404, f"Profile '{pid}' not found")
    profile["name"] = name
    _write_meta(meta)
    return {**profile, "data_dir": str(_profile_dir(pid))}


@router.post("/{pid}/activate")
def activate_profile(pid: str) -> dict:
    meta = _read_meta()
    profile = next((p for p in meta.get("profiles", []) if p["id"] == pid), None)
    if not profile:
        raise HTTPException(404, f"Profile '{pid}' not found")
    meta["active_id"] = pid
    _write_meta(meta)
    target = _profile_dir(pid)
    target.mkdir(parents=True, exist_ok=True)
    set_data_dir(target)
    return {"ok": True, "profile": {**profile, "data_dir": str(target)}}


@router.delete("/{pid}")
def delete_profile(pid: str) -> dict:
    if pid == "default":
        raise HTTPException(400, "Cannot delete the default profile")
    meta = _read_meta()
    idx = next((i for i, p in enumerate(meta.get("profiles", [])) if p["id"] == pid), None)
    if idx is None:
        raise HTTPException(404, f"Profile '{pid}' not found")
    # Remove data directory
    try:
        shutil.rmtree(_profile_dir(pid), ignore_errors=True)
    except Exception:
        pass
    meta["profiles"].pop(idx)
    # If we deleted the active profile, fall back to default
    if meta.get("active_id") == pid:
        meta["active_id"] = "default"
        set_data_dir(_root())
    _write_meta(meta)
    return {"ok": True}
