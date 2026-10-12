from pydantic import BaseModel, Field
from typing import Optional

__all__ = ["ValueSnapshot", "Account", "AccountsData", "AccountCreate", "AccountUpdate",
           "ACCOUNT_TYPES", "ACCOUNT_TYPE_LABELS"]


ACCOUNT_TYPES = [
    "401k",            # US employer plan
    "403b",            # US employer plan (non-profit / education)
    "457b",            # US governmental deferred compensation
    "traditional_ira", # US pre-tax IRA
    "roth_ira",        # US Roth IRA
    "hsa",             # US health savings account
    "529",             # US education savings
    "pension",         # UK pension / SIPP
    "isa",             # UK ISA
    "brokerage",       # Taxable brokerage
    "cash",            # Savings / high-yield savings
    "checking",        # Checking / current account
    "crypto",
    "company_stock",   # RSUs / ESPP
    "alternative",     # Private equity, angel, funds
    "property",        # Real estate
    "other",
]

ACCOUNT_TYPE_LABELS = {
    "401k": "401(k)",
    "403b": "403(b)",
    "457b": "457(b)",
    "traditional_ira": "Traditional IRA",
    "roth_ira": "Roth IRA",
    "hsa": "HSA",
    "529": "529 plan",
    "pension": "Pension / SIPP",
    "isa": "ISA",
    "brokerage": "Brokerage",
    "cash": "Savings",
    "checking": "Checking",
    "crypto": "Crypto",
    "company_stock": "Company Stock",
    "alternative": "Alternative",
    "property": "Property",
    "other": "Other",
}


class ValueSnapshot(BaseModel):
    """A timestamped record of an account's value — archived each time the value changes."""
    date: str
    value: float


class _AccountFields(BaseModel):
    institution: str = ""
    account_number: str = ""
    account_type: str = "other"
    currency: str = "USD"
    value: float = 0.0
    notes: str = ""
    risk_profile: Optional[str] = None
    expected_return: Optional[float] = None       # annual decimal, overrides the type default
    # Your own contributions, in the account's currency
    contribution_amount: Optional[float] = None
    contribution_frequency: Optional[str] = None  # weekly|biweekly|semimonthly|monthly|annual
    annual_lump_sum: Optional[float] = None       # e.g. a yearly bonus paid in
    # Employer match
    #   fixed       -> employer_match_amount per employer_match_frequency (monthly|annual)
    #   pct_salary  -> employer_match_pct % of gross salary
    #   pct_contrib -> employer_match_pct % of your contributions, on contributions up to
    #                  employer_match_cap_pct % of salary (when a cap and salary are known)
    employer_match_mode: Optional[str] = None
    employer_match_amount: Optional[float] = None
    employer_match_frequency: Optional[str] = None
    employer_match_pct: Optional[float] = None
    employer_match_cap_pct: Optional[float] = None
    tax_treatment: Optional[str] = None           # pre_tax | roth, for workplace plans
    hsa_coverage: Optional[str] = None            # self | family


class Account(_AccountFields):
    id: str
    name: str
    last_updated: Optional[str] = None
    value_history: list[ValueSnapshot] = Field(default_factory=list)


class AccountsData(BaseModel):
    accounts: list[Account] = Field(default_factory=list)


class AccountCreate(_AccountFields):
    name: str
    last_updated: Optional[str] = None


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    institution: Optional[str] = None
    account_number: Optional[str] = None
    account_type: Optional[str] = None
    currency: Optional[str] = None
    value: Optional[float] = None
    notes: Optional[str] = None
    last_updated: Optional[str] = None
    risk_profile: Optional[str] = None
    expected_return: Optional[float] = None
    contribution_amount: Optional[float] = None
    contribution_frequency: Optional[str] = None
    annual_lump_sum: Optional[float] = None
    employer_match_mode: Optional[str] = None
    employer_match_amount: Optional[float] = None
    employer_match_frequency: Optional[str] = None
    employer_match_pct: Optional[float] = None
    employer_match_cap_pct: Optional[float] = None
    tax_treatment: Optional[str] = None
    hsa_coverage: Optional[str] = None
    value_history: Optional[list[ValueSnapshot]] = None
