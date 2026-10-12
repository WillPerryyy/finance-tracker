import httpx
from datetime import datetime, timezone


async def fetch_exchange_rates() -> dict:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://open.er-api.com/v6/latest/USD")
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                    "base": "USD",
                    "rates": data.get("rates", {}),
                }
    except Exception:
        pass

    # Fallback
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://api.frankfurter.app/latest?from=USD")
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "last_updated": datetime.now(timezone.utc).isoformat(),
                    "base": "USD",
                    "rates": data.get("rates", {}),
                }
    except Exception:
        pass

    return {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "base": "USD",
        "rates": {},
        "error": "Failed to fetch rates",
    }
