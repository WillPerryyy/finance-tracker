# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Finance Tracker backend server.

Build with:
  python -m PyInstaller backend.spec

Output: dist/backend_server/backend_server.exe (--onedir, fast startup)
"""

from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

# ── Collect all submodules from packages that use dynamic imports ────────────
datas    = []
binaries = []
hiddenimports = []

for pkg in [
    "uvicorn",
    "fastapi",
    "starlette",
    "pydantic",
    "pydantic_settings",
    "anyio",
    "sniffio",
    "h11",
    "httpx",
    "httpcore",
    "certifi",
    "aiofiles",
    "openpyxl",
]:
    d, b, h = collect_all(pkg)
    datas    += d
    binaries += b
    hiddenimports += h

# yfinance + deps — collect_all ensures data files (e.g. pandas timezone data) are bundled.
# Explicitly skip numba/llvmlite: they require tbb12.dll which is rarely present on end-user
# machines and would cause a silent crash at startup if bundled without that DLL.
for pkg in ["yfinance", "pandas", "requests", "urllib3", "charset_normalizer"]:
    try:
        d, b, h = collect_all(pkg)
        datas    += d
        binaries += b
        hiddenimports += h
    except Exception as e:
        print(f"Warning: could not collect {pkg}: {e}")

# Backend modules must be explicit (they're not in site-packages)
backend_modules = [
    "backend",
    "backend.main",
    "backend.config",
    "backend.storage",
    "backend.api",
    "backend.api.accounts",
    "backend.api.projections",
    "backend.api.alternatives",
    "backend.api.travel",
    "backend.api.exchange_rates",
    "backend.api.market_data",
    "backend.api.dashboard",
    "backend.api.life_events",
    "backend.api.profiles",
    "backend.models",
    "backend.models.account",
    "backend.models.projection",
    "backend.models.alternative",
    "backend.models.travel",
    "backend.models.enums",
    "backend.services",
    "backend.services.exchange_rate_service",
    "backend.services.stock_price_service",
    "backend.services.crypto_price_service",
]

hiddenimports += backend_modules + [
    # uvicorn internals that get missed
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    # email (used internally by some packages)
    "email.mime.text",
    "email.mime.multipart",
    "email.mime.base",
    # multipart (FastAPI file uploads)
    "multipart",
]

a = Analysis(
    ["backend_server.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas + [
        # Bundle the built React frontend so the exe can serve it via FastAPI StaticFiles.
        # PyInstaller extracts these to sys._MEIPASS at runtime; backend/main.py's path
        # resolution (Path(__file__).parent.parent / "frontend/dist") finds them correctly.
        ("frontend/dist", "frontend/dist"),
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "PIL", "cv2", "scipy", "numba", "llvmlite"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,          # --onedir: DLLs live alongside the exe
    name="backend_server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,                      # skip UPX — can cause false AV positives
    console=False,                  # no terminal window visible to the user
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="backend_server",          # output dir: dist/backend_server/
)
