from pydantic import BaseModel, Field
from typing import Optional


class Milestone(BaseModel):
    age: int
    year: int


class ProjectionRow(BaseModel):
    year: int
    deposit: float = 0.0
    growth_pct: Optional[float] = None
    value: float = 0.0


class PropertyRow(BaseModel):
    year: int
    assets: float = 0.0
    debt: float = 0.0
    equity: float = 0.0


class ProjectionCategory(BaseModel):
    id: str
    label: str
    currency: str = "USD"
    rows: list[ProjectionRow] = Field(default_factory=list)
    property_rows: list[PropertyRow] = Field(default_factory=list)


class ProjectionsData(BaseModel):
    salary: float = 0.0
    base_currency: str = "USD"
    birth_year: int = 1996
    retirement_target: float = 0.0
    milestones: list[Milestone] = Field(default_factory=list)
    categories: list[ProjectionCategory] = Field(default_factory=list)
    us_roe: Optional[float] = None


class ProjectionSettingsUpdate(BaseModel):
    salary: Optional[float] = None
    retirement_target: Optional[float] = None
    birth_year: Optional[int] = None
    milestones: Optional[list[Milestone]] = None
