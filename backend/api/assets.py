import uuid
from fastapi import APIRouter, HTTPException

from ..config import settings
from ..storage import read_json, write_json
from ..models.asset import (
    AccountData, Position, Transaction,
    PositionCreate, PositionUpdate,
    TransactionCreate, TransactionUpdate,
    QuickUpdate,
)

router = APIRouter(prefix="/api/assets", tags=["assets"])

ACCOUNT_DEFAULTS = {
    "gbp": {"account_id": "gbp_brokerage", "currency": "GBP", "label": "UK Brokerage (GBP)"},
    "usd": {"account_id": "usd_brokerage", "currency": "USD", "label": "US Brokerage (USD)"},
}


def _load(account: str) -> AccountData:
    path = settings.account_path(account)
    raw = read_json(path)
    if not raw:
        defaults = ACCOUNT_DEFAULTS.get(account, {"account_id": account, "currency": "USD", "label": account})
        return AccountData(**defaults)
    return AccountData(**raw)


def _save(account: str, data: AccountData) -> None:
    write_json(settings.account_path(account), data.model_dump())


@router.get("/{account}")
def get_account(account: str) -> AccountData:
    return _load(account)


# --- Positions ---

@router.get("/{account}/positions")
def list_positions(account: str, status: str | None = None) -> list[Position]:
    data = _load(account)
    if status:
        return [p for p in data.positions if p.status == status]
    return data.positions


@router.get("/{account}/positions/open")
def list_open_positions(account: str) -> list[Position]:
    return [p for p in _load(account).positions if p.status == "open"]


@router.post("/{account}/positions")
def create_position(account: str, body: PositionCreate) -> Position:
    data = _load(account)
    pos = Position(id=f"pos_{uuid.uuid4().hex[:8]}", **body.model_dump())
    data.positions.append(pos)
    _save(account, data)
    return pos


@router.put("/{account}/positions/{position_id}")
def update_position(account: str, position_id: str, body: PositionUpdate) -> Position:
    data = _load(account)
    for i, p in enumerate(data.positions):
        if p.id == position_id:
            updates = body.model_dump(exclude_none=True)
            data.positions[i] = p.model_copy(update=updates)
            _save(account, data)
            return data.positions[i]
    raise HTTPException(404, "Position not found")


@router.delete("/{account}/positions/{position_id}")
def delete_position(account: str, position_id: str) -> dict:
    data = _load(account)
    data.positions = [p for p in data.positions if p.id != position_id]
    _save(account, data)
    return {"deleted": position_id}


@router.post("/{account}/quick-update")
def quick_update(account: str, body: QuickUpdate) -> dict:
    data = _load(account)
    data.positions = [p for p in data.positions if p.status == "closed"]
    data.positions.append(Position(
        id=f"pos_{uuid.uuid4().hex[:8]}",
        asset=f"{account.upper()}_TOTAL",
        asset_type="other",
        shares=1,
        cost_basis=body.total_value,
        average_price=body.total_value,
        status="open",
    ))
    _save(account, data)
    return {"updated": True, "total_value": body.total_value}


# --- Transactions ---

@router.get("/{account}/transactions")
def list_transactions(
    account: str,
    asset: str | None = None,
    type: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[Transaction]:
    txns = _load(account).transactions
    if asset:
        txns = [t for t in txns if t.asset == asset]
    if type:
        txns = [t for t in txns if t.type == type]
    if date_from:
        txns = [t for t in txns if t.date >= date_from]
    if date_to:
        txns = [t for t in txns if t.date <= date_to]
    return txns


@router.post("/{account}/transactions")
def create_transaction(account: str, body: TransactionCreate) -> Transaction:
    data = _load(account)
    txn = Transaction(id=f"txn_{uuid.uuid4().hex[:8]}", **body.model_dump())
    data.transactions.append(txn)
    _save(account, data)
    return txn


@router.put("/{account}/transactions/{txn_id}")
def update_transaction(account: str, txn_id: str, body: TransactionUpdate) -> Transaction:
    data = _load(account)
    for i, t in enumerate(data.transactions):
        if t.id == txn_id:
            updates = body.model_dump(exclude_none=True)
            data.transactions[i] = t.model_copy(update=updates)
            _save(account, data)
            return data.transactions[i]
    raise HTTPException(404, "Transaction not found")


@router.delete("/{account}/transactions/{txn_id}")
def delete_transaction(account: str, txn_id: str) -> dict:
    data = _load(account)
    data.transactions = [t for t in data.transactions if t.id != txn_id]
    _save(account, data)
    return {"deleted": txn_id}
