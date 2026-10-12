from fastapi import APIRouter

from ..config import settings
from ..storage import read_json, write_json
from ..services.exchange_rate_service import fetch_exchange_rates

router = APIRouter(prefix="/api/exchange-rates", tags=["exchange-rates"])


@router.get("")
def get_rates() -> dict:
    return read_json(settings.exchange_rates_path) or {"base": "USD", "rates": {}}


@router.post("/refresh")
async def refresh_rates() -> dict:
    rates = await fetch_exchange_rates()
    write_json(settings.exchange_rates_path, rates)
    return rates
