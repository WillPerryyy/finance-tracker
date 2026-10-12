from ..config import settings
from ..storage import read_json


def convert_currency(value: float, from_curr: str, to_curr: str, rates: dict) -> float:
    if from_curr == to_curr or not rates:
        return value
    r = rates.get("rates", {})
    if from_curr == "USD":
        return value * r.get(to_curr, 1.0)
    elif to_curr == "USD":
        return value / r.get(from_curr, 1.0)
    else:
        return (value / r.get(from_curr, 1.0)) * r.get(to_curr, 1.0)


def calculate_portfolio_summary(display_currency: str = "USD") -> dict:
    rates = read_json(settings.exchange_rates_path) or {}
    market = read_json(settings.market_cache_path) or {}
    stocks = market.get("stocks", {})

    total = 0.0
    by_class: dict[str, float] = {}
    by_currency: dict[str, float] = {}

    for acc_name, curr in [("gbp", "GBP"), ("usd", "USD")]:
        acc = read_json(settings.account_path(acc_name))
        if not acc:
            continue
        for pos in acc.get("positions", []):
            if pos.get("status") != "open":
                continue
            symbol = pos.get("asset", "")
            shares = pos.get("shares", 0)
            price_info = stocks.get(symbol)
            if price_info:
                val = shares * price_info["price"]
            else:
                val = pos.get("cost_basis", 0)
            converted = convert_currency(val, curr, display_currency, rates)
            asset_type = pos.get("asset_type", "stock")
            label = f"{acc_name.upper()} {asset_type.capitalize()}"
            by_class[label] = by_class.get(label, 0) + converted
            by_currency[curr] = by_currency.get(curr, 0) + converted
            total += converted

    return {
        "total": round(total, 2),
        "by_class": {k: round(v, 2) for k, v in by_class.items()},
        "by_currency": {k: round(v, 2) for k, v in by_currency.items()},
    }
