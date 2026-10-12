import uuid
import datetime
from fastapi import APIRouter, HTTPException

from ..config import settings
from ..storage import read_json, write_json
from ..models.account import ValueSnapshot
from ..models.debt import Debt, DebtsData, DebtCreate, DebtUpdate, DEBT_TYPES

router = APIRouter(prefix="/api/debts", tags=["debts"])


def _load() -> DebtsData:
    raw = read_json(settings.debts_path)
    return DebtsData(**raw) if raw else DebtsData()


def _save(data: DebtsData) -> None:
    write_json(settings.debts_path, data.model_dump())


@router.get("")
def list_debts() -> list[Debt]:
    return _load().debts


@router.get("/types")
def debt_types() -> dict:
    return DEBT_TYPES


@router.post("", status_code=201)
def create_debt(body: DebtCreate) -> Debt:
    data = _load()
    fields = body.model_dump()
    fields["last_updated"] = fields.get("last_updated") or datetime.date.today().isoformat()
    debt = Debt(id=f"debt_{uuid.uuid4().hex[:8]}", **fields)
    data.debts.append(debt)
    _save(data)
    return debt


@router.put("/{debt_id}")
def update_debt(debt_id: str, body: DebtUpdate) -> Debt:
    data = _load()
    for i, d in enumerate(data.debts):
        if d.id == debt_id:
            updates = body.model_dump(exclude_unset=True)
            new_balance = updates.get("balance")
            if new_balance is not None and new_balance != d.balance and d.last_updated and "balance_history" not in updates:
                history = list(d.balance_history)
                history.append(ValueSnapshot(date=d.last_updated, value=d.balance))
                updates["balance_history"] = history[-200:]
            if "balance" in updates and "last_updated" not in updates:
                updates["last_updated"] = datetime.date.today().isoformat()
            updated = d.model_copy(update=updates)
            data.debts[i] = updated
            _save(data)
            return updated
    raise HTTPException(404, "Debt not found")


@router.delete("/{debt_id}")
def delete_debt(debt_id: str) -> dict:
    data = _load()
    before = len(data.debts)
    data.debts = [d for d in data.debts if d.id != debt_id]
    if len(data.debts) == before:
        raise HTTPException(404, "Debt not found")
    _save(data)
    return {"deleted": debt_id}
