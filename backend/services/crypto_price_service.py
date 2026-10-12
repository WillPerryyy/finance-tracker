import httpx
from datetime import datetime, timezone


async def fetch_crypto_prices(coingecko_ids: dict[str, str]) -> dict:
    if not coingecko_ids:
        return {}

    ids_str = ",".join(coingecko_ids.values())
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={ids_str}&vs_currencies=usd&include_24hr_change=true"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return {}

            data = resp.json()
            result = {}
            id_to_symbol = {v: k for k, v in coingecko_ids.items()}

            for cg_id, info in data.items():
                symbol = id_to_symbol.get(cg_id, cg_id.upper())
                result[symbol] = {
                    "price": info.get("usd", 0),
                    "change_pct": round(info.get("usd_24h_change", 0), 2),
                    "currency": "USD",
                    "updated": datetime.now(timezone.utc).isoformat(),
                }
            return result
    except Exception:
        return {}
