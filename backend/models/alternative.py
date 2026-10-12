from pydantic import BaseModel, Field
from typing import Optional


class AlternativeInvestment(BaseModel):
    id: str
    name: str
    date: str
    value: float
    currency: str = "USD"
    exit_date: Optional[str] = None
    exit_value: Optional[float] = None
    carry_fees: float = 0.0
    notes: str = ""
    category: str = "other"


class AlternativesData(BaseModel):
    investments: list[AlternativeInvestment] = Field(default_factory=list)


class AlternativeCreate(BaseModel):
    name: str
    date: str
    value: float
    currency: str = "USD"
    exit_date: Optional[str] = None
    exit_value: Optional[float] = None
    carry_fees: float = 0.0
    notes: str = ""
    category: str = "other"


class AlternativeUpdate(BaseModel):
    name: Optional[str] = None
    date: Optional[str] = None
    value: Optional[float] = None
    currency: Optional[str] = None
    exit_date: Optional[str] = None
    exit_value: Optional[float] = None
    carry_fees: Optional[float] = None
    notes: Optional[str] = None
    category: Optional[str] = None
