from pydantic import BaseModel, Field
from typing import Optional
from .enums import AssetType, TransactionType, PositionStatus


class OptionDetails(BaseModel):
    underlying: str
    type: str  # "put" or "call"
    strike: float
    expiry: str


class Position(BaseModel):
    id: str
    asset: str
    asset_type: AssetType = AssetType.STOCK
    shares: float
    cost_basis: float
    average_price: float
    status: PositionStatus = PositionStatus.OPEN
    opened_date: Optional[str] = None
    closed_date: Optional[str] = None
    sale_value: Optional[float] = None
    profit_loss: Optional[float] = None
    option_details: Optional[OptionDetails] = None


class Transaction(BaseModel):
    id: str
    date: str
    asset: str
    type: TransactionType
    shares: float
    value: float
    price_per_share: Optional[float] = None
    fees: float = 0.0
    notes: str = ""


class AccountData(BaseModel):
    account_id: str
    currency: str
    label: str
    positions: list[Position] = Field(default_factory=list)
    transactions: list[Transaction] = Field(default_factory=list)


class PositionCreate(BaseModel):
    asset: str
    asset_type: AssetType = AssetType.STOCK
    shares: float
    cost_basis: float
    average_price: float
    status: PositionStatus = PositionStatus.OPEN
    opened_date: Optional[str] = None
    closed_date: Optional[str] = None
    sale_value: Optional[float] = None
    profit_loss: Optional[float] = None
    option_details: Optional[OptionDetails] = None


class PositionUpdate(BaseModel):
    asset: Optional[str] = None
    asset_type: Optional[AssetType] = None
    shares: Optional[float] = None
    cost_basis: Optional[float] = None
    average_price: Optional[float] = None
    status: Optional[PositionStatus] = None
    opened_date: Optional[str] = None
    closed_date: Optional[str] = None
    sale_value: Optional[float] = None
    profit_loss: Optional[float] = None


class TransactionCreate(BaseModel):
    date: str
    asset: str
    type: TransactionType
    shares: float
    value: float
    price_per_share: Optional[float] = None
    fees: float = 0.0
    notes: str = ""


class TransactionUpdate(BaseModel):
    date: Optional[str] = None
    asset: Optional[str] = None
    type: Optional[TransactionType] = None
    shares: Optional[float] = None
    value: Optional[float] = None
    price_per_share: Optional[float] = None
    fees: Optional[float] = None
    notes: Optional[str] = None


class QuickUpdate(BaseModel):
    total_value: float
