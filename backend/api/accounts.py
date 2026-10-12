import uuid
import datetime
from fastapi import APIRouter, HTTPException

from ..config import settings
from ..storage import read_json, write_json
from ..models.account import Account, AccountsData, AccountCreate, AccountUpdate, ValueSnapshot, ACCOUNT_TYPE_LABELS

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


def _load() -> AccountsData:
    raw = read_json(settings.accounts_path)
    if not raw:
        return AccountsData()
    return AccountsData(**raw)


def _save(data: AccountsData) -> None:
    write_json(settings.accounts_path, data.model_dump())


@router.get("")
def list_accounts() -> list[Account]:
    return _load().accounts


@router.post("", status_code=201)
def create_account(body: AccountCreate) -> Account:
    data = _load()
    fields = body.model_dump()
    fields["last_updated"] = fields.get("last_updated") or datetime.date.today().isoformat()
    account = Account(id=f"acc_{uuid.uuid4().hex[:8]}", **fields)
    data.accounts.append(account)
    _save(data)
    return account


@router.put("/{account_id}")
def update_account(account_id: str, body: AccountUpdate) -> Account:
    data = _load()
    for i, acc in enumerate(data.accounts):
        if acc.id == account_id:
            updates = body.model_dump(exclude_unset=True)

            # When the value changes, archive the current value+date into history
            new_value = updates.get("value")
            if new_value is not None and new_value != acc.value and acc.last_updated:
                history = list(acc.value_history)
                history.append(ValueSnapshot(date=acc.last_updated, value=acc.value))
                updates["value_history"] = history[-200:]  # cap at 200 snapshots

            # Stamp last_updated if caller didn't provide an explicit "as of" date
            if "value" in updates and "last_updated" not in updates:
                updates["last_updated"] = datetime.date.today().isoformat()

            updated = acc.model_copy(update=updates)
            data.accounts[i] = updated
            _save(data)
            return updated
    raise HTTPException(status_code=404, detail="Account not found")


@router.delete("/{account_id}")
def delete_account(account_id: str) -> dict:
    data = _load()
    before = len(data.accounts)
    data.accounts = [a for a in data.accounts if a.id != account_id]
    if len(data.accounts) == before:
        raise HTTPException(status_code=404, detail="Account not found")
    _save(data)
    return {"deleted": account_id}


@router.get("/types")
def account_types() -> dict:
    return ACCOUNT_TYPE_LABELS
