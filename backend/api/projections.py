import datetime
from collections import defaultdict
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..config import settings, get_data_dir
from ..storage import read_json, write_json
from ..models.projection import ProjectionsData, ProjectionCategory, ProjectionSettingsUpdate

router = APIRouter(prefix="/api/projections", tags=["projections"])

# ── Assumptions ───────────────────────────────────────────────────────────────

DEFAULT_RISK_PROFILES: dict[str, dict] = {
    "brokerage":       {"profile": "aggressive",      "expected_return": 0.08},
    "isa":             {"profile": "aggressive",      "expected_return": 0.08},
    "401k":            {"profile": "moderate",        "expected_return": 0.07},
    "403b":            {"profile": "moderate",        "expected_return": 0.07},
    "457b":            {"profile": "moderate",        "expected_return": 0.07},
    "traditional_ira": {"profile": "moderate",        "expected_return": 0.07},
    "roth_ira":        {"profile": "moderate",        "expected_return": 0.07},
    "hsa":             {"profile": "moderate",        "expected_return": 0.07},
    "529":             {"profile": "moderate",        "expected_return": 0.06},
    "pension":         {"profile": "moderate",        "expected_return": 0.065},
    "crypto":          {"profile": "very_aggressive", "expected_return": 0.15},
    "property":        {"profile": "conservative",    "expected_return": 0.035},
    "cash":            {"profile": "conservative",    "expected_return": 0.04},
    "checking":        {"profile": "conservative",    "expected_return": 0.0},
    "company_stock":   {"profile": "aggressive",      "expected_return": 0.09},
    "alternative":     {"profile": "moderate",        "expected_return": 0.075},
    "other":           {"profile": "moderate",        "expected_return": 0.07},
}

PAY_MULTIPLIERS: dict[str, int] = {
    "weekly": 52, "biweekly": 26, "semimonthly": 24, "monthly": 12, "annual": 1,
}

ACCOUNT_TYPE_LABELS: dict[str, str] = {
    "401k": "401(k)", "403b": "403(b)", "457b": "457(b)", "traditional_ira": "Traditional IRA",
    "roth_ira": "Roth IRA", "hsa": "HSA", "529": "529 plan", "pension": "Pension",
    "isa": "ISA", "brokerage": "Brokerage", "cash": "Savings", "checking": "Checking",
    "crypto": "Crypto", "company_stock": "Company Stock", "alternative": "Alternative",
    "property": "Property", "other": "Other",
}

DEBT_LABELS: dict[str, str] = {
    "mortgage": "Mortgage", "student_loan": "Student loan", "auto": "Car loan",
    "credit_card": "Credit card", "personal": "Personal loan", "other": "Other debt",
}

WORKPLACE_PLANS = {"401k", "403b", "457b"}
PRE_TAX_TYPES = {"401k", "403b", "457b", "traditional_ira", "pension"}
TAX_FREE_TYPES = {"isa", "hsa", "529"}
CASH_TYPES = {"cash", "checking"}
# Where money comes from when the plan needs to pay for something and no account was named.
# Retirement accounts are never drawn on automatically.
LIQUID_ORDER = ["cash", "checking", "brokerage", "isa", "crypto", "alternative", "company_stock", "other"]
# Where extra savings go when there's more to invest than the accounts' own contributions.
# Accounts a savings goal counts when none are chosen: money you could reasonably spend on a deposit.
GOAL_DEFAULT_TYPES = ("cash", "checking", "brokerage", "isa", "other")
SAVINGS_TARGET_ORDER = ["brokerage", "isa", "cash", "checking", "401k", "403b", "roth_ira", "other"]

DEFAULT_RETIREMENT_AGE = 65
DEFAULT_INFLATION_PCT = 2.5
DEFAULT_MORTGAGE_RATE_PCT = 6.5
ASSUMED_AGE_WHEN_UNKNOWN = 35


def _fx(value: float, from_cur: str, to_cur: str, rates: dict) -> float:
    if from_cur == to_cur:
        return value
    r = rates.get("rates", {})
    if not r:
        return value
    if from_cur == "USD":
        return value * r.get(to_cur, 1.0)
    if to_cur == "USD":
        return value / r.get(from_cur, 1.0)
    return (value / r.get(from_cur, 1.0)) * r.get(to_cur, 1.0)


def _rate(acc_type: str, risk_profiles: dict) -> float:
    cfg = risk_profiles.get(acc_type) or DEFAULT_RISK_PROFILES.get(acc_type, {"expected_return": 0.07})
    return cfg.get("expected_return", 0.07) if isinstance(cfg, dict) else 0.07


def tax_bucket(acc_type: str, override: str | None = None) -> str:
    """pre_tax | roth | tax_free | taxable | cash | property"""
    if acc_type in WORKPLACE_PLANS and override == "roth":
        return "roth"
    if acc_type in PRE_TAX_TYPES:
        return "pre_tax"
    if acc_type == "roth_ira":
        return "roth"
    if acc_type in TAX_FREE_TYPES:
        return "tax_free"
    if acc_type in CASH_TYPES:
        return "cash"
    if acc_type == "property":
        return "property"
    return "taxable"


def employee_contribution(acc: dict) -> float:
    """Yearly amount you pay in yourself, in the account's currency."""
    amt = float(acc.get("contribution_amount") or 0)
    freq = (acc.get("contribution_frequency") or "").strip()
    regular = amt * PAY_MULTIPLIERS.get(freq, 0) if amt > 0 and freq else float(acc.get("monthly_contribution") or 0) * 12
    return regular + float(acc.get("annual_lump_sum") or 0)


def employer_match(acc: dict, salary_native: float) -> float:
    """Yearly employer match, in the account's currency."""
    mode = acc.get("employer_match_mode")
    pct = float(acc.get("employer_match_pct") or 0) / 100
    if mode == "fixed":
        amt = float(acc.get("employer_match_amount") or 0)
        return amt * (12 if acc.get("employer_match_frequency") == "monthly" else 1)
    if mode == "pct_salary":
        return salary_native * pct
    if mode == "pct_contrib":
        regular = employee_contribution(acc) - float(acc.get("annual_lump_sum") or 0)
        cap_pct = float(acc.get("employer_match_cap_pct") or 0) / 100
        matched_on = min(regular, salary_native * cap_pct) if cap_pct > 0 and salary_native > 0 else regular
        return matched_on * pct
    return 0.0


def _amortized_payment(principal: float, annual_rate_pct: float, years: int) -> float:
    n = years * 12
    r = annual_rate_pct / 100 / 12
    if n <= 0:
        return 0.0
    if r == 0:
        return principal / n
    return principal * r / (1 - (1 + r) ** -n)


DEFAULT_CATEGORIES = [
    {"id": "lti", "label": "Long Term Investments", "currency": "USD"},
    {"id": "401k", "label": "401k", "currency": "USD"},
    {"id": "uk_pension", "label": "UK Pension", "currency": "GBP"},
    {"id": "alternatives", "label": "Alternative Investments", "currency": "USD"},
    {"id": "crypto", "label": "Crypto", "currency": "USD"},
    {"id": "company_stock", "label": "Company Stock", "currency": "USD"},
    {"id": "property", "label": "Property", "currency": "USD"},
]


def _load() -> ProjectionsData:
    raw = read_json(settings.projections_path)
    if not raw:
        return ProjectionsData(categories=[ProjectionCategory(**c) for c in DEFAULT_CATEGORIES])
    return ProjectionsData(**raw)


def _save(data: ProjectionsData) -> None:
    write_json(settings.projections_path, data.model_dump())


# ── Core simulation ───────────────────────────────────────────────────────────

def _simulate_forecast(
    user_settings: dict,
    all_accounts: list[dict],
    rates: dict,
    life_events_data: dict | None = None,
    all_debts: list[dict] | None = None,
    profile_timelines: dict[str, int] | None = None,
) -> dict:
    """
    Year-by-year projection of every account and debt from today to retirement.

    Rules the engine keeps:
      * No account ever goes below zero. Money the plan needs but can't find is recorded
        as that year's shortfall rather than borrowed silently.
      * Debts amortise monthly. Payments on debts you already have are assumed to be outside
        your savings; once one is paid off its payment can be redirected into savings.
      * Values are nominal. `real_total` deflates them to today's money with the inflation setting.
    profile_timelines maps a partner's profile label to the year their contributions stop.
    """
    display_currency = user_settings.get("display_currency", "USD")
    today = datetime.date.today()
    current_year = today.year

    assumed: list[str] = []
    birth_year = user_settings.get("birth_year")
    if not birth_year:
        birth_year = current_year - ASSUMED_AGE_WHEN_UNKNOWN
        assumed.append("birth_year")
    birth_year = int(birth_year)
    retirement_age = user_settings.get("retirement_age")
    if not retirement_age:
        retirement_age = DEFAULT_RETIREMENT_AGE
        assumed.append("retirement_age")
    retirement_age = int(retirement_age)

    retirement_target = float(user_settings.get("retirement_target") or 0)
    target_in_todays_money = user_settings.get("target_in_todays_money", True) is not False
    inflation = float(user_settings.get("inflation_pct", DEFAULT_INFLATION_PCT)) / 100
    salary = float(user_settings.get("salary") or 0)
    risk_profiles: dict = {**DEFAULT_RISK_PROFILES, **(user_settings.get("risk_profiles") or {})}

    retirement_year = birth_year + retirement_age
    if retirement_year <= current_year:
        retirement_year = current_year + 1

    day_of_year = today.timetuple().tm_yday
    leap = current_year % 4 == 0 and (current_year % 100 != 0 or current_year % 400 == 0)
    remaining_frac = max(0.01, ((366 if leap else 365) - day_of_year + 1) / (366 if leap else 365))

    # ── Accounts ──────────────────────────────────────────────────────────────
    sims: list[dict] = []
    employee_total = 0.0
    match_total = 0.0
    for idx, acc in enumerate(all_accounts):
        cur = acc.get("currency", "USD")
        t = acc.get("account_type", "other")
        pl = acc.get("profile_label")
        salary_native = 0.0 if pl else _fx(salary, display_currency, cur, rates)
        emp = _fx(employee_contribution(acc), cur, display_currency, rates)
        mat = _fx(employer_match(acc, salary_native), cur, display_currency, rates)
        if not pl:
            employee_total += emp
            match_total += mat
        rate = acc.get("expected_return")
        sims.append({
            "key":       f"{pl or 'me'}:{acc.get('id') or idx}",
            "id":        acc.get("id"),
            "name":      acc.get("name") or ACCOUNT_TYPE_LABELS.get(t, t),
            "type":      t,
            "tax":       tax_bucket(t, acc.get("tax_treatment")),
            "value":     _fx(float(acc.get("value") or 0), cur, display_currency, rates),
            "rate":      float(rate if rate is not None else _rate(t, risk_profiles)),
            "employee":  emp,
            "match":     mat,
            "profile":   pl,
            "stop_year": (profile_timelines or {}).get(pl, retirement_year) if pl else retirement_year,
        })

    # ── Debts ─────────────────────────────────────────────────────────────────
    debts: list[dict] = []
    for idx, d in enumerate(all_debts or []):
        cur = d.get("currency", "USD")
        pl = d.get("profile_label")
        debts.append({
            "key":       f"debt:{pl or 'me'}:{d.get('id') or idx}",
            "id":        d.get("id"),
            "name":      d.get("name") or DEBT_LABELS.get(d.get("debt_type", "other"), "Debt"),
            "type":      d.get("debt_type", "other"),
            "balance":   _fx(float(d.get("balance") or 0), cur, display_currency, rates),
            "rate":      float(d.get("interest_rate") or 0) / 100,
            "payment":   _fx(float(d.get("monthly_payment") or 0), cur, display_currency, rates),
            "redirect":  d.get("redirect_when_paid", True) is not False and not pl,
            "new":       False,
            "profile":   pl,
            "paid_year": None,
        })

    current_assets = sum(s["value"] for s in sims)
    current_debts = sum(d["balance"] for d in debts)
    weighted_return = (sum(s["value"] * s["rate"] for s in sims) / current_assets) if current_assets else 0.0

    # ── Helpers ───────────────────────────────────────────────────────────────
    def withdraw(amount: float, preferred: str | None) -> float:
        """Take money from accounts without letting any go below zero. Returns what couldn't be found."""
        remaining = amount
        order: list[str] = []
        if preferred and preferred != "savings":
            order.append(preferred)
        order += [t for t in LIQUID_ORDER if t not in order]
        for t in order:
            for s in sims:
                if remaining <= 0.005:
                    return 0.0
                if s["type"] == t and s["value"] > 0 and not s["profile"]:
                    taken = min(s["value"], remaining)
                    s["value"] -= taken
                    remaining -= taken
        return max(0.0, remaining)

    def deposit(amount: float) -> None:
        for t in SAVINGS_TARGET_ORDER:
            for s in sims:
                if s["type"] == t and not s["profile"]:
                    s["value"] += amount
                    return
        sims.append({
            "key": "extra:savings", "name": "New savings", "type": "brokerage", "tax": "taxable",
            "value": amount, "rate": _rate("brokerage", risk_profiles), "employee": 0.0, "match": 0.0,
            "profile": None, "stop_year": retirement_year,
        })

    def event_sim(key: str, name: str, t: str, value: float) -> dict:
        return {
            "key": key, "name": name, "type": t, "tax": tax_bucket(t), "value": value,
            "rate": _rate(t, risk_profiles), "employee": 0.0, "match": 0.0,
            "profile": None, "stop_year": retirement_year,
        }

    def infl(year: int) -> float:
        """Price level in `year` relative to today. Life-event amounts are entered in today's money."""
        return (1 + inflation) ** max(0, year - current_year)

    # ── Life events ───────────────────────────────────────────────────────────
    events_by_year: dict[int, list[dict]] = defaultdict(list)
    for evt in (life_events_data or {}).get("events", []):
        if evt.get("year"):
            events_by_year[int(evt["year"])].append(evt)

    # Changes to saving, as (start, end_exclusive or None, kind, amount):
    #   "delta"    adds `amount` to what you save each year (negative means spending more)
    #   "override" makes your own yearly saving equal to `amount`
    adjustments: list[tuple[int, int | None, str, float]] = []
    scheduled_costs: list[tuple[int, int, float, str | None]] = []   # education: today's-money cost a year
    recurring_costs: list[tuple[int, int, float]] = []               # children: today's-money cost a year

    forecast_rows: list[dict] = []
    goals: list[dict] = []
    warnings: list[dict] = []

    for year in range(current_year, retirement_year + 1):
        frac = remaining_frac if year == current_year else 1.0
        shortfall = 0.0

        # Savings goals are measured at the start of their year (the end of the year before), so the
        # money is counted before anything bought that year spends it. The target is entered in
        # today's money and grown with inflation to that point.
        for evt in events_by_year.get(year, []):
            if evt.get("type") == "down_payment_target":
                chosen = evt.get("account_ids") or []
                counted = [
                    s for s in sims
                    if not s["profile"] and (s.get("id") in chosen if chosen else s["type"] in GOAL_DEFAULT_TYPES)
                ]
                years_out = max(0.0, (year - 1 - current_year) + remaining_frac) if year > current_year else 0.0
                deflator = (1 + inflation) ** years_out
                target_today = float(evt.get("target_amount") or evt.get("amount") or 0)
                target_amt = target_today * deflator
                liquid = sum(s["value"] for s in counted)
                goals.append({
                    "id": evt.get("id", ""), "label": evt.get("label", ""), "year": year,
                    "target": round(target_amt, 2), "target_today": target_today,
                    "projected_liquid": round(liquid, 2), "projected_today": round(liquid / deflator, 2),
                    "deflator": round(deflator, 6),
                    "accounts": [{"name": s["name"], "value": round(s["value"], 2), "rate_pct": round(s["rate"] * 100, 2)} for s in counted],
                    "default_accounts": not chosen,
                    "on_track": liquid >= target_amt, "shortfall": round(max(0.0, target_amt - liquid), 2),
                })

        for evt in events_by_year.get(year, []):
            et = evt.get("type", "")
            ecur = evt.get("currency") or display_currency
            eid = evt.get("id") or year
            if et == "property_purchase":
                dp = float(evt.get("down_payment") or 0) * infl(year)
                price = float(evt.get("property_value") or 0) * infl(year) or dp
                unmet = withdraw(dp, evt.get("funded_from") or "cash") if dp > 0 else 0.0
                shortfall += unmet
                if price > 0:
                    sims.append(event_sim(f"event:{eid}:property", evt.get("label") or "Home", "property", price))
                principal = max(0.0, price - (dp - unmet))
                mrate = float(evt.get("mortgage_rate") or DEFAULT_MORTGAGE_RATE_PCT)
                years = int(evt.get("mortgage_years") or 0)
                payment = float(evt.get("mortgage_monthly") or 0) or (_amortized_payment(principal, mrate, years) if years else 0.0)
                if principal > 0 and payment > 0:
                    debts.append({
                        "key": f"debt:event:{eid}", "id": None,
                        "name": f"Mortgage, {evt.get('label') or 'home'}", "type": "mortgage",
                        "balance": principal, "rate": mrate / 100, "payment": payment,
                        "redirect": False, "new": True, "profile": None, "paid_year": None,
                    })
                rent = float(evt.get("rent_monthly") or 0) * infl(year)
                if rent > 0:
                    adjustments.append((year, None, "delta", rent * 12))
            elif et == "expense":
                amt = _fx(float(evt.get("amount") or 0), ecur, display_currency, rates) * infl(year)
                if amt > 0:
                    shortfall += withdraw(amt, evt.get("funded_from"))
            elif et == "windfall":
                amt = _fx(float(evt.get("amount") or 0), ecur, display_currency, rates) * infl(year)
                if amt > 0:
                    sims.append(event_sim(f"event:{eid}:windfall", evt.get("label") or f"Windfall {year}",
                                          evt.get("into_type") or "brokerage", amt))
            elif et in ("savings_change", "income_change", "career_break", "semi_retirement"):
                new_s = evt.get("new_annual_savings")
                if et == "career_break" and new_s is None:
                    new_s = 0
                if new_s is not None:
                    dur = evt.get("duration_years")
                    adjustments.append((year, year + int(dur) if dur else None, "override", float(new_s)))
            elif et == "child":
                cost = float(evt.get("annual_cost") or 0)
                if cost > 0:
                    recurring_costs.append((year, year + int(evt.get("duration_years") or 18), cost))
            elif et == "education":
                cost = float(evt.get("annual_cost") or 0)
                if cost > 0:
                    scheduled_costs.append((year, year + int(evt.get("duration_years") or 4), cost, evt.get("funded_from") or "529"))
            elif et == "debt_payoff":
                target = next((d for d in debts if d["id"] and d["id"] == evt.get("debt_id")), None)
                if target and target["balance"] > 0:
                    want = _fx(float(evt.get("amount") or 0), ecur, display_currency, rates) * infl(year) or target["balance"]
                    want = min(want, target["balance"])
                    unmet = withdraw(want, evt.get("funded_from"))
                    target["balance"] -= (want - unmet)
                    if target["balance"] <= 0.005:
                        target["balance"] = 0.0
                        target["paid_year"] = year
                    shortfall += unmet

        # Growth and each account's own contributions
        for s in sims:
            s["value"] *= (1.0 + s["rate"]) ** frac
            if year <= s["stop_year"]:
                s["value"] += (s["employee"] + s["match"]) * frac

        # Debts amortise monthly
        months = max(1, round(12 * frac))
        new_debt_outflow = 0.0
        freed = 0.0
        for d in debts:
            for _ in range(months):
                if d["balance"] <= 0.005:
                    if d["redirect"]:
                        freed += d["payment"]
                    continue
                d["balance"] = d["balance"] * (1 + d["rate"] / 12) - d["payment"]
                if d["new"]:
                    new_debt_outflow += d["payment"] + min(0.0, d["balance"])
                if d["balance"] <= 0:
                    d["balance"] = 0.0
                    d["paid_year"] = d["paid_year"] or year

        # Changes to what you save
        base_saving = sum(s["employee"] for s in sims if not s["profile"] and year <= s["stop_year"])
        extra = 0.0
        override = None
        for start, end, kind, amt in adjustments:
            if year >= start and (end is None or year < end):
                if kind == "delta":
                    extra += amt
                else:
                    override = amt
        if override is not None:
            extra += override - base_saving
        for start, end, cost in recurring_costs:
            if start <= year < end:
                extra -= cost * infl(year)
        extra = extra * frac + freed - new_debt_outflow

        for start, end, cost, src in scheduled_costs:
            if start <= year < end:
                shortfall += withdraw(cost * infl(year) * frac, src)

        if extra > 0:
            deposit(extra)
        elif extra < 0:
            shortfall += withdraw(-extra, None)

        if shortfall > 1:
            warnings.append({"year": year, "shortfall": round(shortfall, 2)})

        # ── Row ───────────────────────────────────────────────────────────────
        by_type: dict[str, float] = {}
        by_account: dict[str, float] = {}
        by_tax: dict[str, float] = defaultdict(float)
        for s in sims:
            label = ACCOUNT_TYPE_LABELS.get(s["type"], s["type"].replace("_", " ").title())
            if s["profile"]:
                label = f"{s['profile']} · {label}"
            by_type[label] = by_type.get(label, 0.0) + s["value"]
            by_account[s["key"]] = by_account.get(s["key"], 0.0) + s["value"]
            by_tax[s["tax"]] += s["value"]
        debts_total = 0.0
        for d in debts:
            debts_total += d["balance"]
            by_account[d["key"]] = -d["balance"]
        if debts:
            by_type["Debts"] = -debts_total

        assets = sum(s["value"] for s in sims)
        total = assets - debts_total
        deflator = (1 + inflation) ** ((year - current_year) + remaining_frac)
        forecast_rows.append({
            "year":       year,
            "age":        year - birth_year,
            "assets":     round(assets, 2),
            "debts":      round(debts_total, 2),
            "total":      round(total, 2),
            "real_total": round(total / deflator, 2),
            "deflator":   round(deflator, 6),
            "shortfall":  round(shortfall, 2),
            "by_type":    {k: round(v, 2) for k, v in by_type.items()},
            "by_account": {k: round(v, 2) for k, v in by_account.items()},
            "by_tax":     {k: round(v, 2) for k, v in by_tax.items()},
        })

    last = forecast_rows[-1] if forecast_rows else None

    target_hit_year = target_hit_age = None
    if retirement_target > 0:
        for row in forecast_rows:
            if (row["real_total"] if target_in_todays_money else row["total"]) >= retirement_target:
                target_hit_year, target_hit_age = row["year"], row["age"]
                break

    # ── Recorded history: accounts minus debts, one point per year ───────────
    year_items: dict[int, dict[str, dict]] = defaultdict(dict)

    def add_snap(key: str, date_str: str, val: float, cur: str) -> None:
        yr = int(date_str[:4])
        existing = year_items[yr].get(key)
        if existing is None or date_str > existing["date"]:
            year_items[yr][key] = {"date": date_str, "value": val, "currency": cur}

    for acc in all_accounts:
        key = f"a:{acc.get('profile_label') or ''}:{acc.get('id')}"
        for snap in acc.get("value_history", []):
            add_snap(key, snap["date"], snap["value"], acc.get("currency", "USD"))
        if acc.get("last_updated"):
            add_snap(key, acc["last_updated"], float(acc.get("value") or 0), acc.get("currency", "USD"))
    for d in all_debts or []:
        key = f"d:{d.get('profile_label') or ''}:{d.get('id')}"
        for snap in d.get("balance_history", []):
            add_snap(key, snap["date"], -snap["value"], d.get("currency", "USD"))
        if d.get("last_updated"):
            add_snap(key, d["last_updated"], -float(d.get("balance") or 0), d.get("currency", "USD"))
    history_rows = [
        {"year": yr, "total": round(sum(_fx(s["value"], s["currency"], display_currency, rates) for s in year_items[yr].values()), 2)}
        for yr in sorted(year_items)
    ]

    # ── Series metadata for the chart and tables ─────────────────────────────
    account_series: list[dict] = []
    for s in sims:
        account_series.append({
            "key": s["key"], "name": s["name"], "type": s["type"], "kind": "asset", "tax": s["tax"],
            "type_label": ACCOUNT_TYPE_LABELS.get(s["type"], s["type"].replace("_", " ").title()),
            "profile": s["profile"], "rate_pct": round(s["rate"] * 100, 2),
        })
    for d in debts:
        account_series.append({
            "key": d["key"], "name": d["name"], "type": d["type"], "kind": "debt", "tax": None,
            "type_label": DEBT_LABELS.get(d["type"], "Debt"), "profile": d["profile"],
            "rate_pct": round(d["rate"] * 100, 2), "paid_year": d["paid_year"],
        })

    return {
        "forecast":                     forecast_rows,
        "account_series":               account_series,
        "history":                      history_rows,
        "birth_year":                   birth_year,
        "retirement_year":              retirement_year,
        "retirement_age":               retirement_age,
        "retirement_target":            retirement_target,
        "target_in_todays_money":       target_in_todays_money,
        "inflation_pct":                round(inflation * 100, 3),
        "projected_at_retirement":      last["total"] if last else 0.0,
        "projected_at_retirement_real": last["real_total"] if last else 0.0,
        "annual_savings":               round(employee_total + match_total, 2),
        "employee_savings":             round(employee_total, 2),
        "employer_match":               round(match_total, 2),
        "salary":                       salary,
        "current_total":                round(current_assets - current_debts, 2),
        "current_assets":               round(current_assets, 2),
        "current_debts":                round(current_debts, 2),
        "target_hit_year":              target_hit_year,
        "target_hit_age":               target_hit_age,
        "weighted_return_pct":          round(weighted_return * 100, 2),
        "currency":                     display_currency,
        "savings_target_results":       goals,
        "warnings":                     warnings,
        "assumed":                      assumed,
    }


# ── CRUD endpoints (legacy manual projections) ────────────────────────────────

@router.get("")
def get_projections() -> ProjectionsData:
    return _load()


@router.put("")
def replace_projections(body: ProjectionsData) -> ProjectionsData:
    _save(body)
    return body


@router.put("/settings")
def update_settings(body: ProjectionSettingsUpdate) -> ProjectionsData:
    data = _load()
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(data, k, v)
    _save(data)
    return data


@router.put("/categories/{cat_id}")
def update_category(cat_id: str, body: ProjectionCategory) -> ProjectionCategory:
    data = _load()
    for i, cat in enumerate(data.categories):
        if cat.id == cat_id:
            data.categories[i] = body
            _save(data)
            return body
    raise HTTPException(404, f"Category {cat_id} not found")


# ── Forecast endpoints ────────────────────────────────────────────────────────

@router.get("/forecast")
def forecast() -> dict:
    return _simulate_forecast(
        user_settings=read_json(settings.settings_path) or {},
        all_accounts=(read_json(settings.accounts_path) or {}).get("accounts", []),
        rates=read_json(settings.exchange_rates_path) or {},
        life_events_data=read_json(settings.life_events_path) or {},
        all_debts=(read_json(settings.debts_path) or {}).get("debts", []),
    )


@router.post("/combined-forecast")
def combined_forecast(body: dict) -> dict:
    """
    Merge other profiles into this forecast.
      extra_data_dirs : list[str]  data directories of the other profiles
      profile_labels  : list[str]  their display names, same order
    Each partner's contributions stop at their own retirement year.
    """
    extra_dirs = body.get("extra_data_dirs", [])
    labels = body.get("profile_labels", [])
    all_accounts: list[dict] = list((read_json(settings.accounts_path) or {}).get("accounts", []))
    all_debts: list[dict] = list((read_json(settings.debts_path) or {}).get("debts", []))
    timelines: dict[str, int] = {}

    own_dir = get_data_dir().resolve()
    for idx, data_dir in enumerate(extra_dirs):
        p = Path(data_dir)
        if p.resolve() == own_dir:
            continue  # the active profile is already included
        label = labels[idx] if idx < len(labels) else f"Profile {idx + 2}"
        theirs = read_json(p / "settings.json") or {}
        if theirs.get("birth_year"):
            timelines[label] = int(theirs["birth_year"]) + int(theirs.get("retirement_age") or DEFAULT_RETIREMENT_AGE)
        for acc in (read_json(p / "accounts.json") or {}).get("accounts", []):
            all_accounts.append({**acc, "profile_label": label})
        for d in (read_json(p / "debts.json") or {}).get("debts", []):
            all_debts.append({**d, "profile_label": label})

    for acc in body.get("extra_accounts", []):
        all_accounts.append(dict(acc))

    return _simulate_forecast(
        user_settings=read_json(settings.settings_path) or {},
        all_accounts=all_accounts,
        rates=read_json(settings.exchange_rates_path) or {},
        life_events_data=read_json(settings.life_events_path) or {},
        all_debts=all_debts,
        profile_timelines=timelines,
    )


@router.get("/summary")
def projection_summary() -> dict:
    data = _load()
    yearly_totals: dict[int, float] = {}
    for cat in data.categories:
        for row in cat.rows:
            yearly_totals[row.year] = yearly_totals.get(row.year, 0) + row.value
        for row in cat.property_rows:
            yearly_totals[row.year] = yearly_totals.get(row.year, 0) + row.equity
    current_year = datetime.date.today().year
    retirement_year = None
    if data.retirement_target > 0:
        for year in sorted(yearly_totals):
            if yearly_totals[year] >= data.retirement_target:
                retirement_year = year
                break
    return {
        "yearly_totals": dict(sorted(yearly_totals.items())),
        "current_total": yearly_totals.get(current_year, 0.0),
        "retirement_target": data.retirement_target,
        "retirement_year": retirement_year,
    }
