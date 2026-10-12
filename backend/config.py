from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

# ── Runtime-mutable active data directory ────────────────────────────────────
# None means "use settings.data_dir" (the value from env/config).
# Set by the profiles API when the user switches profiles.
_active_data_dir: Path | None = None


def get_data_dir() -> Path:
    """Returns the currently active data directory."""
    return _active_data_dir if _active_data_dir is not None else settings.data_dir


def set_data_dir(path: Path) -> None:
    """Switch the active data directory (called by the profiles API)."""
    global _active_data_dir
    _active_data_dir = Path(path)


# ── Settings ──────────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    """
    Settings loaded from environment variables (Pydantic Settings auto-reads DATA_DIR, etc.)
    When running under Electron, DATA_DIR is set to the active profile's data directory.
    All path properties use get_data_dir() so they reflect profile switches at runtime.
    """
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Finance Tracker"
    data_dir: Path = Path(__file__).parent.parent / "data"
    port: int = 8200
    auto_refresh_interval_minutes: int = 15

    @property
    def accounts_path(self) -> Path:
        return get_data_dir() / "accounts.json"

    @property
    def debts_path(self) -> Path:
        return get_data_dir() / "debts.json"

    @property
    def life_events_path(self) -> Path:
        return get_data_dir() / "life_events.json"

    @property
    def alternatives_path(self) -> Path:
        return get_data_dir() / "alternatives.json"

    @property
    def projections_path(self) -> Path:
        return get_data_dir() / "projections.json"

    @property
    def travel_path(self) -> Path:
        return get_data_dir() / "travel.json"

    @property
    def exchange_rates_path(self) -> Path:
        return get_data_dir() / "exchange_rates.json"

    @property
    def market_cache_path(self) -> Path:
        return get_data_dir() / "market_cache.json"

    @property
    def settings_path(self) -> Path:
        return get_data_dir() / "settings.json"

    def account_path(self, account: str) -> Path:
        return get_data_dir() / f"assets_{account}.json"


settings = Settings()
