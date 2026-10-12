import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as http from 'http';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;

// ─── Path helpers ────────────────────────────────────────────────────────────

function getProjectRoot(): string {
  // app.isPackaged is true only when running from an installed package (NSIS/DMG).
  // When running via `electron .` from source, it is false.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..', '..');
}

function getBackendCmd(): { cmd: string; args: string[] } {
  if (app.isPackaged) {
    // Packaged: use the PyInstaller-compiled backend executable.
    const ext  = process.platform === 'win32' ? '.exe' : '';
    const exe  = path.join(process.resourcesPath, 'backend_server', `backend_server${ext}`);
    return { cmd: exe, args: [] };
  }

  // Development / unpackaged: spawn Python and run uvicorn.
  // On Windows, use the 'py' launcher (installed with Python) which reliably
  // finds the correct interpreter even when 'python' points to the Store stub.
  const pyCmd = process.platform === 'win32' ? 'py' : 'python3';
  return {
    cmd: pyCmd,
    args: ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8200', '--reload'],
  };
}

// ─── Backend management ───────────────────────────────────────────────────────

function waitForBackend(port = 8200, maxAttempts = 300): Promise<boolean> {
  return new Promise(resolve => {
    let attempts = 0;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, res => {
        if (res.statusCode === 200) { resolve(true); }
        else { retry(); }
      });
      req.on('error', retry);
      req.setTimeout(500, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (++attempts >= maxAttempts) { resolve(false); return; }
      setTimeout(check, 100);
    };
    check();
  });
}

async function startBackend(dataDir: string): Promise<void> {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
    await new Promise(r => setTimeout(r, 600));
  }

  const { cmd, args } = getBackendCmd();
  // Packaged: resources/app doesn't exist on disk (the app is inside app.asar),
  // and spawn() throws ENOENT if cwd is missing — use the backend's own folder.
  const cwd = app.isPackaged ? path.dirname(cmd) : getProjectRoot();

  // For the packaged backend_server.exe, pass data-dir and port as CLI args.
  // For dev (uvicorn), pass data-dir via env var (DATA_DIR).
  const fullArgs = app.isPackaged
    ? [...args, '--host', '127.0.0.1', '--port', '8200', '--data-dir', dataDir]
    : args;

  backendProcess = spawn(cmd, fullArgs, {
    cwd,
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout?.on('data', d => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr?.on('data', d => process.stdout.write(`[backend] ${d}`));
  backendProcess.on('error', err => console.error('Backend spawn error:', err));

  const ready = await waitForBackend();
  if (!ready) console.warn('Backend did not respond in time — opening window anyway');
}

// ─── Window ───────────────────────────────────────────────────────────────────

function getIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(getProjectRoot(), 'assets', 'icon.ico');
}

const SPLASH_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#1e2a3a;color:#fff;font-family:"Segoe UI",sans-serif}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
  .logo{width:72px;height:72px;border-radius:14px;background:#2563eb;display:flex;align-items:center;
        justify-content:center;font-weight:700;font-size:30px}
  .name{font-size:18px;font-weight:600}
  .bar{width:160px;height:3px;background:rgba(255,255,255,.12);border-radius:2px;overflow:hidden}
  .bar i{display:block;width:40%;height:100%;background:#2563eb;animation:s 1s ease-in-out infinite}
  @keyframes s{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
</style></head><body><div class="logo">FT</div><div class="name">Finance Tracker</div>
<div class="bar"><i></i></div></body></html>`;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Finance Tracker',
    show: false,                // revealed only after maximize, avoiding a resize flash
    backgroundColor: '#1e2a3a', // matches the nav colour so the flash matches the header
  });

  // Show a splash immediately; the real app loads once the backend answers /health.
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML));

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();   // launch full-screen by default
    mainWindow?.show();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function loadApp(): void {
  mainWindow?.loadURL('http://localhost:8200');
}

// ─── IPC helpers ─────────────────────────────────────────────────────────────

/** Fetch JSON from the backend API (backend must be running on port 8200). */
function backendGet(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:8200${path}`, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function backendPost(path: string, payload: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      hostname: '127.0.0.1',
      port: 8200,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// Wire IPC handlers — proxy to backend REST API so preload.ts calls work.
ipcMain.handle('profiles:list', async () => {
  try {
    const data = await backendGet('/api/profiles');
    return data.profiles ?? [];
  } catch { return []; }
});

ipcMain.handle('profiles:current', async () => {
  try {
    const data = await backendGet('/api/profiles');
    const activeId = data.active_id;
    return (data.profiles ?? []).find((p: any) => p.id === activeId) ?? null;
  } catch { return null; }
});

ipcMain.handle('profiles:create', async (_event, name: string) => {
  try { return await backendPost('/api/profiles', { name }); }
  catch { return null; }
});

ipcMain.handle('profiles:select', async (_event, id: string) => {
  try { return await backendPost(`/api/profiles/${id}/activate`, {}); }
  catch { return null; }
});

ipcMain.handle('profiles:delete', async (_event, id: string) => {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: 8200, path: `/api/profiles/${id}`, method: 'DELETE' };
    const req = http.request(opts, res => {
      let data = ''; res.on('data', d => { data += d; }); res.on('end', () => resolve(true));
    });
    req.on('error', reject);
    req.end();
  }).catch(() => false);
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  // Single-user app: always use one fixed data directory.
  // - Dev (unpackaged): project's own data/ folder beside the source
  // - Packaged installer: <AppData>/Roaming/Finance Tracker/data/
  const dataDir = app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : path.join(getProjectRoot(), 'data');

  // Ensure the data directory exists (first-run for packaged installs).
  fs.mkdirSync(dataDir, { recursive: true });

  // Window (with splash) and backend start in parallel.
  createWindow();
  await startBackend(dataDir);
  loadApp();
});

app.on('window-all-closed', () => {
  backendProcess?.kill();
  backendProcess = null;
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) { createWindow(); loadApp(); }
});

app.on('will-quit', () => {
  backendProcess?.kill();
  backendProcess = null;
});
