import uuid
from fastapi import APIRouter, HTTPException

from ..config import settings
from ..storage import read_json, write_json
from ..models.alternative import AlternativesData, AlternativeInvestment, AlternativeCreate, AlternativeUpdate

router = APIRouter(prefix="/api/alternatives", tags=["alternatives"])


def _load() -> AlternativesData:
    raw = read_json(settings.alternatives_path)
    if not raw:
        return AlternativesData()
    return AlternativesData(**raw)


def _save(data: AlternativesData) -> None:
    write_json(settings.alternatives_path, data.model_dump())


@router.get("")
def list_alternatives() -> list[AlternativeInvestment]:
    return _load().investments


@router.post("")
def create_alternative(body: AlternativeCreate) -> AlternativeInvestment:
    data = _load()
    inv = AlternativeInvestment(id=f"alt_{uuid.uuid4().hex[:8]}", **body.model_dump())
    data.investments.append(inv)
    _save(data)
    return inv


@router.put("/{inv_id}")
def update_alternative(inv_id: str, body: AlternativeUpdate) -> AlternativeInvestment:
    data = _load()
    for i, inv in enumerate(data.investments):
        if inv.id == inv_id:
            updates = body.model_dump(exclude_none=True)
            data.investments[i] = inv.model_copy(update=updates)
            _save(data)
            return data.investments[i]
    raise HTTPException(404, "Investment not found")


@router.delete("/{inv_id}")
def delete_alternative(inv_id: str) -> dict:
    data = _load()
    data.investments = [inv for inv in data.investments if inv.id != inv_id]
    _save(data)
    return {"deleted": inv_id}
