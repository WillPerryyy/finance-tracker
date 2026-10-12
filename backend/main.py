import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .storage import read_json, write_json
from .api import accounts, projections, alternatives, travel, exchange_rates, market_data, dashboard, life_events, profiles, debts, backup
from .services.exchange_rate_service import fetch_exchange_rates
from .services.stock_price_service import fetch_stock_prices
from .services.crypto_price_service import fetch_crypto_prices

logger = logging.getLogger(__name__)


async def background_refresh_loop():
    while True:
        try:
            await asyncio.sleep(settings.auto_refresh_interval_minutes * 60)
            logger.info("Running background refresh...")

            # Exchange rates
            rates = await fetch_exchange_rates()
            write_json(settings.exchange_rates_path, rates)

            user_settings = read_json(settings.settings_path) or {}
            tickers: set[str] = set()
            yahoo_map = user_settings.get("yahoo_finance_symbols", {})
            coingecko_ids = user_settings.get("coingecko_ids", {})

            cache = read_json(settings.market_cache_path) or {"stocks": {}, "crypto": {}}
            if tickers:
                cache["stocks"] = await fetch_stock_prices(tickers, yahoo_map)
            if coingecko_ids:
                cache["crypto"] = await fetch_crypto_prices(coingecko_ids)
            write_json(settings.market_cache_path, cache)

            logger.info("Background refresh complete")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Background refresh error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure the root data directory exists first (needed to read profiles.json)
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    # Restore the last-active profile's data directory
    from .api.profiles import init_active_profile
    init_active_profile()

    # Ensure the active profile directory exists (may differ from root after switch)
    from .config import get_data_dir
    get_data_dir().mkdir(parents=True, exist_ok=True)

    # Initial fetch
    try:
        rates = await fetch_exchange_rates()
        write_json(settings.exchange_rates_path, rates)
    except Exception as e:
        logger.error(f"Initial rate fetch failed: {e}")

    task = asyncio.create_task(background_refresh_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Finance Tracker", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(profiles.router)
app.include_router(accounts.router)
app.include_router(debts.router)
app.include_router(backup.router)
app.include_router(projections.router)
app.include_router(life_events.router)
app.include_router(alternatives.router)
app.include_router(travel.router)
app.include_router(exchange_rates.router)
app.include_router(market_data.router)
app.include_router(dashboard.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/settings")
def get_settings():
    # Birth year is deliberately absent: a new profile is asked for it during onboarding
    # rather than silently assuming one.
    return read_json(settings.settings_path) or {
        "display_currency": "USD",
        "auto_refresh_interval_minutes": 15,
        "coingecko_ids": {"BTC": "bitcoin", "ETH": "ethereum"},
    }


@app.put("/api/settings")
def update_settings(body: dict):
    current = read_json(settings.settings_path) or {}
    current.update(body)
    write_json(settings.settings_path, current)
    return current


# ── Static frontend (serve built React app) ──────────────────────────────────
# Expects `npm run build:web` to have been run in the frontend/ directory.
# All /api/* and /health routes above are matched first; everything else is
# either a static asset or a React-router client-side route (SPA fallback).

import sys as _sys

# In a PyInstaller onedir bundle, sys._MEIPASS is the _internal/ directory
# where all data files land.  Fall back to the source-tree path for dev.
if hasattr(_sys, "_MEIPASS"):
    _dist = Path(_sys._MEIPASS) / "frontend" / "dist"
else:
    _dist = Path(__file__).parent.parent / "frontend" / "dist"

if _dist.exists():
    # Serve hashed asset bundles (JS/CSS/fonts/images)
    app.mount("/assets", StaticFiles(directory=str(_dist / "assets")), name="static-assets")

    # Loose files at dist root (favicon, icons, etc.)
    @app.get("/favicon.svg", include_in_schema=False)
    async def favicon():
        return FileResponse(str(_dist / "favicon.svg"))

    @app.get("/icons.svg", include_in_schema=False)
    async def icons():
        return FileResponse(str(_dist / "icons.svg"))

    # SPA fallback — any unmatched GET returns index.html so React Router works
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        return FileResponse(str(_dist / "index.html"))
