"""
Entry point for the standalone backend executable (built with PyInstaller).
Parses CLI args, sets DATA_DIR so pydantic-settings picks it up, then starts uvicorn.

Usage:
  backend_server.exe --port 8200 --data-dir "C:/Users/foo/AppData/Roaming/FinanceTracker/data"
"""
import os
import sys


def _parse_args():
    port = 8200
    data_dir = None
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--port" and i + 1 < len(args):
            port = int(args[i + 1])
            i += 2
        elif args[i] == "--data-dir" and i + 1 < len(args):
            data_dir = args[i + 1]
            i += 2
        else:
            i += 1
    return port, data_dir


def main():
    port, data_dir = _parse_args()

    # Set DATA_DIR *before* any backend imports so pydantic-settings
    # reads the correct value when Settings() is instantiated.
    if data_dir:
        os.environ["DATA_DIR"] = data_dir

    # PyInstaller sets sys._MEIPASS when running from a --onedir bundle.
    # We need to add the bundle dir to sys.path so `import backend` works.
    if hasattr(sys, "_MEIPASS"):
        bundle_dir = sys._MEIPASS
        if bundle_dir not in sys.path:
            sys.path.insert(0, bundle_dir)

    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host="127.0.0.1",
        port=port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
