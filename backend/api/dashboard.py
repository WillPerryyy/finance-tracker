import datetime
from fastapi import APIRouter

from ..config import settings
from ..storage import read_json

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

# Human-readable group labels for each account type
TYPE_GROUP = {
    "brokerage": "Brokerage",
    "isa": "ISA",
    "401k": "401(k)",
    "roth_ira": "Roth IRA",
    "pension": "Pension / SIPP",
    "crypto": "Crypto",
    "property": "Property",
    "cash": "Cash / Bank",
    "company_stock": "Company Stock",
    "alternative": "Alternative",
    "other": "Other",
}


def _convert(value: float, from_currency: str, to_currency: str, rates: dict) -> float:
    if from_currency == to_currency:
        return value
    r = rates.get("rates", {})
    if not r:
        return value
    if from_currency == "USD":
        return value * r.get(to_currency, 1.0)
    elif to_currency == "USD":
        return value / r.get(from_currency, 1.0)
    else:
        return (value / r.get(from_currency, 1.0)) * r.get(to_currency, 1.0)


@router.get("/net-worth")
def net_worth() -> dict:
    user_settings = read_json(settings.settings_path) or {}
    display_currency = user_settings.get("display_currency", "USD")
    rates = read_json(settings.exchange_rates_path) or {}

    total = 0.0
    breakdown: dict[str, float] = {}
    by_currency: dict[str, float] = {}

    # All accounts
    accounts_data = read_json(settings.accounts_path) or {}
    for acc in accounts_data.get("accounts", []):
        val = acc.get("value", 0.0)
        curr = acc.get("currency", "USD")
        acc_type = acc.get("account_type", "other")
        label = TYPE_GROUP.get(acc_type, "Other")
        converted = _convert(val, curr, display_currency, rates)
        breakdown[label] = breakdown.get(label, 0.0) + converted
        by_currency[curr] = by_currency.get(curr, 0.0) + converted
        total += converted

    # Standalone alternative investments (not in accounts)
    alts = read_json(settings.alternatives_path) or {}
    for inv in alts.get("investments", []):
        if inv.get("exit_date") in (None, "", "N/A"):
            val = inv.get("value", 0.0)
            curr = inv.get("currency", "USD")
            converted = _convert(val, curr, display_currency, rates)
            breakdown["Alternative"] = breakdown.get("Alternative", 0.0) + converted
            by_currency[curr] = by_currency.get(curr, 0.0) + converted
            total += converted

    return {
        "total": round(total, 2),
        "currency": display_currency,
        "breakdown": {k: round(v, 2) for k, v in sorted(breakdown.items(), key=lambda x: -x[1])},
        "by_currency": {k: round(v, 2) for k, v in sorted(by_currency.items(), key=lambda x: -x[1])},
    }


@router.get("/allocation")
def allocation() -> dict:
    return net_worth()["breakdown"]
