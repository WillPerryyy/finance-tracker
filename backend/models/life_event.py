from pydantic import BaseModel, Field
from typing import Optional

EVENT_TYPES: dict[str, str] = {
    "property_purchase":   "Buy a property",
    "down_payment_target": "Savings goal",
    "expense":             "One-off cost",
    "windfall":            "Windfall",
    "income_change":       "Change in income",
    "savings_change":      "Change in savings",
    "child":               "Have a child",
    "education":           "Pay for education",
    "career_break":        "Career break",
    "semi_retirement":     "Go part-time",
    "debt_payoff":         "Pay off a debt early",
}

BUCKET_LABELS: dict[str, str] = {
    "savings":       "Any savings (cash first)",
    "cash":          "Savings",
    "checking":      "Checking",
    "brokerage":     "Brokerage",
    "isa":           "ISA",
    "529":           "529 plan",
    "hsa":           "HSA",
    "401k":          "401(k)",
    "roth_ira":      "Roth IRA",
    "alternative":   "Alternative",
    "company_stock": "Company stock",
    "other":         "Other",
}


class _EventFields(BaseModel):
    notes: str = ""
    # property_purchase
    property_value:   Optional[float] = None
    down_payment:     Optional[float] = None
    funded_from:      Optional[str]   = None
    mortgage_monthly: Optional[float] = None
    mortgage_years:   Optional[int]   = None
    mortgage_rate:    Optional[float] = None   # yearly percent
    rent_monthly:     Optional[float] = None   # rent that stops when you buy
    # down_payment_target
    target_amount:    Optional[float] = None
    account_ids:      Optional[list[str]] = None  # accounts that count toward the goal; None = savings, checking and brokerage
    # expense / windfall / debt_payoff
    amount:   Optional[float] = None
    currency: str = "USD"
    into_type: Optional[str] = None
    debt_id:  Optional[str] = None
    # savings_change / income_change / career_break / semi_retirement
    new_annual_savings: Optional[float] = None
    duration_years:     Optional[int]   = None  # None = until retirement
    # child / education
    annual_cost: Optional[float] = None


class LifeEvent(_EventFields):
    id: str
    type: str
    label: str
    year: int


class LifeEventsData(BaseModel):
    events: list[LifeEvent] = Field(default_factory=list)


class LifeEventCreate(_EventFields):
    type: str
    label: str
    year: int


class LifeEventUpdate(BaseModel):
    type:               Optional[str]   = None
    label:              Optional[str]   = None
    year:               Optional[int]   = None
    notes:              Optional[str]   = None
    property_value:     Optional[float] = None
    down_payment:       Optional[float] = None
    funded_from:        Optional[str]   = None
    mortgage_monthly:   Optional[float] = None
    mortgage_years:     Optional[int]   = None
    mortgage_rate:      Optional[float] = None
    rent_monthly:       Optional[float] = None
    target_amount:      Optional[float] = None
    account_ids:        Optional[list[str]] = None
    amount:             Optional[float] = None
    currency:           Optional[str]   = None
    into_type:          Optional[str]   = None
    debt_id:            Optional[str]   = None
    new_annual_savings: Optional[float] = None
    duration_years:     Optional[int]   = None
    annual_cost:        Optional[float] = None
