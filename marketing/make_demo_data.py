"""
Writes a fictional demo profile ("Alex") for screenshots and the promo video.

    py marketing/make_demo_data.py <empty-data-dir>

Nothing here is real: names, balances and history are invented and generated from a fixed seed,
so the output is the same every run.
"""
import json
import random
import sys
import datetime
from pathlib import Path

random.seed(7)
TODAY = datetime.date.today()


def months_back(n: int) -> list[datetime.date]:
    out = []
    y, m = TODAY.year, TODAY.month
    for _ in range(n):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        out.append(datetime.date(y, m, min(28, TODAY.day)))
    return list(reversed(out))


def history(end_value: float, monthly_add: float, growth: float, months: int, noise: float) -> list[dict]:
    """Walk backwards from today's balance so the series ends exactly where the account is now."""
    values = [end_value]
    v = end_value
    for _ in range(months):
        r = growth / 12 + random.gauss(0, noise)
        v = max(0.0, (v - monthly_add) / (1 + r))
        values.append(v)
    values = list(reversed(values))[:-1]
    return [{"date": d.isoformat(), "value": round(val, 2)} for d, val in zip(months_back(months), values)]


def account(i, name, typ, value, inst, **extra):
    return {
        "id": f"acc_demo{i:02d}", "name": name, "institution": inst, "account_number": "",
        "account_type": typ, "currency": "USD", "value": value, "notes": "",
        "last_updated": (TODAY - datetime.timedelta(days=extra.pop("age_days", 2))).isoformat(),
        "value_history": extra.pop("hist", []), **extra,
    }


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    M = 18
    accounts = [
        account(1, "Fidelity 401(k)", "401k", 84_200, "Fidelity",
                contribution_amount=420, contribution_frequency="biweekly",
                employer_match_mode="pct_contrib", employer_match_pct=100, employer_match_cap_pct=5,
                tax_treatment="pre_tax", hist=history(84_200, 1_430, 0.08, M, 0.025)),
        account(2, "Roth IRA", "roth_ira", 27_500, "Vanguard",
                contribution_amount=583, contribution_frequency="monthly", hist=history(27_500, 583, 0.08, M, 0.028)),
        account(3, "Vanguard Brokerage", "brokerage", 41_300, "Vanguard",
                contribution_amount=500, contribution_frequency="monthly", hist=history(41_300, 500, 0.08, M, 0.03)),
        account(4, "HSA", "hsa", 9_800, "HealthEquity",
                contribution_amount=350, contribution_frequency="monthly", hsa_coverage="self",
                hist=history(9_800, 350, 0.06, M, 0.02)),
        account(5, "High-Yield Savings", "cash", 18_000, "Ally",
                contribution_amount=400, contribution_frequency="monthly", hist=history(18_000, 400, 0.04, M, 0.0)),
        account(6, "Everyday Checking", "checking", 4_200, "Chase", age_days=74,
                hist=history(4_200, 0, 0.0, M, 0.06)),
        account(7, "Bitcoin", "crypto", 3_100, "Coinbase", age_days=96,
                hist=history(3_100, 0, 0.15, M, 0.09)),
    ]
    debts = [
        {"id": "debt_demo01", "name": "Student loan", "lender": "Nelnet", "debt_type": "student_loan", "currency": "USD",
         "balance": 14_500, "interest_rate": 5.2, "monthly_payment": 320, "notes": "", "redirect_when_paid": True,
         "last_updated": (TODAY - datetime.timedelta(days=5)).isoformat(),
         "balance_history": [{"date": d.isoformat(), "value": round(14_500 + 260 * (M - i), 2)} for i, d in enumerate(months_back(M))]},
        {"id": "debt_demo02", "name": "Car loan", "lender": "Capital One", "debt_type": "auto", "currency": "USD",
         "balance": 9_800, "interest_rate": 6.1, "monthly_payment": 410, "notes": "", "redirect_when_paid": True,
         "last_updated": (TODAY - datetime.timedelta(days=5)).isoformat(),
         "balance_history": [{"date": d.isoformat(), "value": round(9_800 + 360 * (M - i), 2)} for i, d in enumerate(months_back(M))]},
    ]
    y = TODAY.year
    events = [
        {"id": "evt_demo01", "type": "down_payment_target", "label": "House deposit", "year": y + 3, "notes": "",
         "target_amount": 70_000, "account_ids": ["acc_demo03", "acc_demo05"], "currency": "USD"},
        {"id": "evt_demo02", "type": "property_purchase", "label": "First home", "year": y + 3, "notes": "",
         "property_value": 380_000, "down_payment": 70_000, "funded_from": "savings", "mortgage_rate": 6.25,
         "mortgage_years": 30, "rent_monthly": 1_900, "currency": "USD"},
        {"id": "evt_demo03", "type": "income_change", "label": "Promotion", "year": y + 2, "notes": "",
         "new_annual_savings": 40_000, "currency": "USD"},
    ]
    settings = {
        "display_currency": "USD", "birth_year": y - 34, "retirement_age": 60, "salary": 125_000,
        "retirement_target": 2_000_000, "target_in_todays_money": True, "inflation_pct": 2.5, "onboarded": True,
        "reminder": {"cadence": "monthly", "day": 1},
        "retirement_plan": {"rate": 4, "growth": 5, "pre_tax_rate": 14, "gains_rate": 15,
                            "fixed": [{"label": "Social Security", "annual": "26000", "start_age": 67}]},
    }
    files = {
        "accounts.json": {"accounts": accounts},
        "debts.json": {"debts": debts},
        "life_events.json": {"events": events},
        "settings.json": settings,
        "profiles.json": {"profiles": [{"id": "default", "name": "Alex", "created": f"{y - 1}-03-02T09:00:00"}], "active_id": "default"},
        "projections.json": {"categories": [], "retirement_target": 0},
    }
    for name, content in files.items():
        (out / name).write_text(json.dumps(content, indent=2))
    print(f"Demo profile written to {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
