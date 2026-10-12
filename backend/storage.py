import json
import tempfile
from pathlib import Path
from typing import Any


def read_json(path: Path) -> Any:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with open(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
        Path(tmp).replace(path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise
