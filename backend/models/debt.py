from pydantic import BaseModel, Field
from typing import Optional

from .account import ValueSnapshot

DEBT_TYPES = {
    "mortgage":     "Mortgage",
    "student_loan": "Student loan",
    "auto":         "Car loan",
    "credit_card":  "Credit card",
    "personal":     "Personal loan",
    "other":        "Other debt",
}


class _DebtFields(BaseModel):
    lender: str = ""
    debt_type: str = "other"
    currency: str = "USD"
    balance: float = 0.0
    interest_rate: float = 0.0        # yearly percent, e.g. 6.5
    monthly_payment: float = 0.0
    notes: str = ""
    # Once paid off, put the freed-up payment towards savings in the forecast.
    redirect_when_paid: bool = True


class Debt(_DebtFields):
    id: str
    name: str
    last_updated: Optional[str] = None
    balance_history: list[ValueSnapshot] = Field(default_factory=list)


class DebtsData(BaseModel):
    debts: list[Debt] = Field(default_factory=list)


class DebtCreate(_DebtFields):
    name: str
    last_updated: Optional[str] = None


class DebtUpdate(BaseModel):
    name: Optional[str] = None
    lender: Optional[str] = None
    debt_type: Optional[str] = None
    currency: Optional[str] = None
    balance: Optional[float] = None
    interest_rate: Optional[float] = None
    monthly_payment: Optional[float] = None
    notes: Optional[str] = None
    redirect_when_paid: Optional[bool] = None
    last_updated: Optional[str] = None
    balance_history: Optional[list[ValueSnapshot]] = None
