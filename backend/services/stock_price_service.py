import asyncio
from datetime import datetime, timezone


async def fetch_stock_prices(tickers: set[str], yahoo_map: dict[str, str]) -> dict:
    def _fetch():
        import yfinance as yf

        # Map tickers to Yahoo Finance symbols
        symbols = []
        ticker_to_original: dict[str, str] = {}
        for t in tickers:
            yahoo_sym = yahoo_map.get(t, t)
            symbols.append(yahoo_sym)
            ticker_to_original[yahoo_sym] = t

        if not symbols:
            return {}

        result = {}
        try:
            data = yf.download(symbols, period="2d", progress=False, threads=True)
            if data.empty:
                return {}

            for yahoo_sym, original in ticker_to_original.items():
                try:
                    if len(symbols) == 1:
                        close_col = data["Close"]
                    else:
                        close_col = data["Close"][yahoo_sym]

                    prices = close_col.dropna()
                    if len(prices) == 0:
                        continue

                    current = float(prices.iloc[-1])
                    prev = float(prices.iloc[-2]) if len(prices) > 1 else current
                    change_pct = ((current - prev) / prev * 100) if prev != 0 else 0

                    result[original] = {
                        "price": round(current, 2),
                        "change_pct": round(change_pct, 2),
                        "currency": "GBP" if yahoo_sym.endswith(".L") else "USD",
                        "updated": datetime.now(timezone.utc).isoformat(),
                    }
                except Exception:
                    continue
        except Exception:
            pass

        return result

    return await asyncio.to_thread(_fetch)
