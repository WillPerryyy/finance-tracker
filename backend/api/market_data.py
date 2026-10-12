from fastapi import APIRouter

from ..config import settings
from ..storage import read_json, write_json
from ..services.stock_price_service import fetch_stock_prices
from ..services.crypto_price_service import fetch_crypto_prices

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("/prices")
def get_prices() -> dict:
    return read_json(settings.market_cache_path) or {"stocks": {}, "crypto": {}}


@router.post("/refresh")
async def refresh_prices() -> dict:
    cache = read_json(settings.market_cache_path) or {"stocks": {}, "crypto": {}}

    # Gather tickers from open positions
    tickers = set()
    for acc in ["gbp", "usd"]:
        acc_data = read_json(settings.account_path(acc))
        if acc_data:
            for pos in acc_data.get("positions", []):
                if pos.get("status") == "open" and pos.get("asset_type") in ("stock", "etf"):
                    tickers.add(pos["asset"])

    user_settings = read_json(settings.settings_path) or {}
    yahoo_map = user_settings.get("yahoo_finance_symbols", {})
    coingecko_ids = user_settings.get("coingecko_ids", {})

    if tickers:
        stocks = await fetch_stock_prices(tickers, yahoo_map)
        cache["stocks"] = stocks

    if coingecko_ids:
        crypto = await fetch_crypto_prices(coingecko_ids)
        cache["crypto"] = crypto

    write_json(settings.market_cache_path, cache)
    return cache


@router.get("/price/{symbol}")
def get_single_price(symbol: str) -> dict:
    cache = read_json(settings.market_cache_path) or {"stocks": {}, "crypto": {}}
    if symbol in cache.get("stocks", {}):
        return cache["stocks"][symbol]
    if symbol in cache.get("crypto", {}):
        return cache["crypto"][symbol]
    return {"error": "Symbol not found in cache"}
