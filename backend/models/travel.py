from pydantic import BaseModel, Field
from typing import Optional


CITY_STATE_MAP: dict[str, str] = {
    "NYC": "New York", "New York": "New York",
    "Chicago": "Illinois",
    "Boston": "Massachusetts",
    "Philadelphia": "Pennsylvania",
    "Los Angeles": "California", "LA": "California",
    "Houston": "Texas",
    "Dallas": "Texas",
    "DC": "District of Columbia", "Washington": "District of Columbia",
    "Atlanta": "Georgia",
    "Nashville": "Tennessee",
    "Denver": "Colorado",
    "Vermont": "Vermont",
    "Toronto": "Ontario",
}

CITY_COUNTRY_MAP: dict[str, str] = {
    "London": "UK", "Dubai": "UAE", "Jubail": "Saudi Arabia",
    "Toronto": "Canada",
    "NYC": "US", "New York": "US", "Chicago": "US", "Boston": "US",
    "Philadelphia": "US", "Los Angeles": "US", "LA": "US",
    "Houston": "US", "Dallas": "US", "DC": "US", "Washington": "US",
    "Atlanta": "US", "Nashville": "US", "Denver": "US", "Vermont": "US",
}


class TravelEntry(BaseModel):
    id: str
    date: str
    origin: str
    destination: str
    origin_state: Optional[str] = None
    origin_country: Optional[str] = None
    destination_state: Optional[str] = None
    destination_country: Optional[str] = None
    notes: str = ""


class TravelData(BaseModel):
    entries: list[TravelEntry] = Field(default_factory=list)


class TravelCreate(BaseModel):
    date: str
    origin: str
    destination: str
    origin_state: Optional[str] = None
    origin_country: Optional[str] = None
    destination_state: Optional[str] = None
    destination_country: Optional[str] = None
    notes: str = ""


class TravelUpdate(BaseModel):
    date: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    origin_state: Optional[str] = None
    origin_country: Optional[str] = None
    destination_state: Optional[str] = None
    destination_country: Optional[str] = None
    notes: Optional[str] = None


class ResidencySummary(BaseModel):
    year: int
    us_days: int = 0
    uk_days_tax_year: int = 0  # Apr 6 - Apr 5
    state_days: dict[str, int] = Field(default_factory=dict)
    country_days: dict[str, int] = Field(default_factory=dict)
