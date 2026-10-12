from enum import Enum


class Currency(str, Enum):
    USD = "USD"
    GBP = "GBP"
    EUR = "EUR"
    INR = "INR"
    AUD = "AUD"
    CAD = "CAD"
    SGD = "SGD"
    CHF = "CHF"
    MYR = "MYR"
    JPY = "JPY"
    CNY = "CNY"


class AssetType(str, Enum):
    STOCK = "stock"
    OPTION = "option"
    ETF = "etf"
    CRYPTO = "crypto"
    OTHER = "other"


class TransactionType(str, Enum):
    BUY = "buy"
    SELL = "sell"


class PositionStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"
