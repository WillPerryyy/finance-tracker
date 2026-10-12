import uuid
from datetime import date, datetime, timedelta
from collections import defaultdict
from fastapi import APIRouter, HTTPException

from ..config import settings
from ..storage import read_json, write_json
from ..models.travel import (
    TravelData, TravelEntry, TravelCreate, TravelUpdate, ResidencySummary,
    CITY_STATE_MAP, CITY_COUNTRY_MAP,
)

router = APIRouter(prefix="/api/travel", tags=["travel"])


def _load() -> TravelData:
    raw = read_json(settings.travel_path)
    if not raw:
        return TravelData()
    return TravelData(**raw)


def _save(data: TravelData) -> None:
    write_json(settings.travel_path, data.model_dump())


def _auto_tag(city: str) -> tuple[str | None, str | None]:
    state = CITY_STATE_MAP.get(city)
    country = CITY_COUNTRY_MAP.get(city)
    if not country:
        country = "US" if state else None
    return state, country


@router.get("")
def list_travel() -> list[TravelEntry]:
    return _load().entries


@router.post("")
def create_travel(body: TravelCreate) -> TravelEntry:
    data = _load()
    if not body.origin_state or not body.origin_country:
        s, c = _auto_tag(body.origin)
        body.origin_state = body.origin_state or s
        body.origin_country = body.origin_country or c
    if not body.destination_state or not body.destination_country:
        s, c = _auto_tag(body.destination)
        body.destination_state = body.destination_state or s
        body.destination_country = body.destination_country or c
    entry = TravelEntry(id=f"trv_{uuid.uuid4().hex[:8]}", **body.model_dump())
    data.entries.append(entry)
    _save(data)
    return entry


@router.put("/{entry_id}")
def update_travel(entry_id: str, body: TravelUpdate) -> TravelEntry:
    data = _load()
    for i, e in enumerate(data.entries):
        if e.id == entry_id:
            updates = body.model_dump(exclude_none=True)
            data.entries[i] = e.model_copy(update=updates)
            _save(data)
            return data.entries[i]
    raise HTTPException(404, "Travel entry not found")


@router.delete("/{entry_id}")
def delete_travel(entry_id: str) -> dict:
    data = _load()
    data.entries = [e for e in data.entries if e.id != entry_id]
    _save(data)
    return {"deleted": entry_id}


@router.get("/residency-summary")
def residency_summary(year: int | None = None) -> list[ResidencySummary]:
    data = _load()
    if not data.entries:
        return []

    entries = sorted(data.entries, key=lambda e: e.date)
    if not year:
        years = set()
        for e in entries:
            y = int(e.date[:4])
            years.add(y)
        return [_calc_residency(entries, y) for y in sorted(years)]

    return [_calc_residency(entries, year)]


def _calc_residency(entries: list[TravelEntry], year: int) -> ResidencySummary:
    state_days: dict[str, int] = defaultdict(int)
    country_days: dict[str, int] = defaultdict(int)
    us_days = 0
    uk_days_tax_year = 0

    cal_start = date(year, 1, 1)
    cal_end = date(year, 12, 31)
    uk_start = date(year - 1, 4, 6)
    uk_end = date(year, 4, 5)

    relevant = [e for e in entries if e.date[:4] in (str(year - 1), str(year), str(year + 1))]
    if not relevant:
        return ResidencySummary(year=year)

    segments: list[tuple[date, str, str | None, str | None]] = []
    for i, entry in enumerate(relevant):
        d = datetime.strptime(entry.date[:10], "%Y-%m-%d").date()
        dest_country = entry.destination_country
        dest_state = entry.destination_state
        dest = entry.destination
        next_date = (
            datetime.strptime(relevant[i + 1].date[:10], "%Y-%m-%d").date()
            if i + 1 < len(relevant)
            else cal_end + timedelta(days=1)
        )
        segments.append((d, dest, dest_state, dest_country))

    for i, (seg_date, dest, seg_state, seg_country) in enumerate(segments):
        next_date = segments[i + 1][0] if i + 1 < len(segments) else cal_end + timedelta(days=1)
        day = seg_date
        while day < next_date:
            if cal_start <= day <= cal_end:
                if seg_country:
                    country_days[seg_country] += 1
                if seg_country == "US":
                    us_days += 1
                    if seg_state:
                        state_days[seg_state] += 1
            if uk_start <= day <= uk_end and seg_country == "UK":
                uk_days_tax_year += 1
            day += timedelta(days=1)

    return ResidencySummary(
        year=year,
        us_days=us_days,
        uk_days_tax_year=uk_days_tax_year,
        state_days=dict(state_days),
        country_days=dict(country_days),
    )


@router.get("/locations")
def get_known_locations() -> dict:
    data = _load()
    origins = sorted(set(e.origin for e in data.entries))
    destinations = sorted(set(e.destination for e in data.entries))
    return {"origins": origins, "destinations": destinations}
