import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from './shared/Modal';
import { Icon } from './ui';
import { daysSince, longDate, todayIso } from '../lib/format';

/* ─── Toasts with undo ──────────────────────────────────────────────────── */

interface Toast { id: number; message: string; undo?: () => void; expires: number }
interface ToastApi {
  notify: (message: string) => void;
  /** Hide something now and only commit the change if the user doesn't press Undo in time. */
  undoable: (opts: { message: string; commit: () => Promise<unknown> | void; onUndo: () => void }) => void;
}

const ToastContext = createContext<ToastApi>({ notify: () => {}, undoable: () => {} });
export const useToast = () => useContext(ToastContext);

const UNDO_MS = 7000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pending = useRef(new Map<number, { commit: () => Promise<unknown> | void; timer: number }>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), []);

  const flush = useCallback((id: number) => {
    const p = pending.current.get(id);
    if (!p) return;
    window.clearTimeout(p.timer);
    pending.current.delete(id);
    void p.commit();
    dismiss(id);
  }, [dismiss]);

  const notify = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts(t => [...t, { id, message, expires: Date.now() + 3500 }]);
    window.setTimeout(() => dismiss(id), 3500);
  }, [dismiss]);

  const undoable = useCallback<ToastApi['undoable']>(({ message, commit, onUndo }) => {
    // Only one pending change at a time keeps the list easy to follow.
    [...pending.current.keys()].forEach(flush);
    const id = nextId.current++;
    const timer = window.setTimeout(() => flush(id), UNDO_MS);
    pending.current.set(id, { commit, timer });
    setToasts(t => [...t, {
      id, message, expires: Date.now() + UNDO_MS,
      undo: () => {
        const p = pending.current.get(id);
        if (p) window.clearTimeout(p.timer);
        pending.current.delete(id);
        onUndo();
        dismiss(id);
      },
    }]);
  }, [flush, dismiss]);

  useEffect(() => {
    const commitAll = () => [...pending.current.keys()].forEach(flush);
    window.addEventListener('beforeunload', commitAll);
    return () => window.removeEventListener('beforeunload', commitAll);
  }, [flush]);

  return (
    <ToastContext.Provider value={{ notify, undoable }}>
      {children}
      <div className="fixed bottom-5 left-5 z-[60] flex flex-col gap-2" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className="dialog-in flex items-center gap-4 rounded-lg px-4 py-3 text-[14px] text-white shadow-lg" style={{ background: 'var(--color-nav)', minWidth: 280 }}>
            <span className="flex-1">{t.message}</span>
            {t.undo && <button className="font-semibold text-[#9ec5f4] hover:underline" onClick={t.undo}>Undo</button>}
            <button className="text-white/60 hover:text-white" aria-label="Dismiss" onClick={() => (t.undo ? flush(t.id) : dismiss(t.id))}><Icon name="close" size={14} /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ─── Keyboard shortcuts ────────────────────────────────────────────────── */

function typingOrDialog(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  if (document.querySelector('[role=dialog]')) return true;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Runs `handler` when `keys` are pressed outside text fields and dialogs. */
export function useShortcut(keys: string | string[], handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  useEffect(() => { ref.current = handler; });
  useEffect(() => {
    if (!enabled) return;
    const list = Array.isArray(keys) ? keys : [keys];
    const onKey = (e: KeyboardEvent) => {
      if (typingOrDialog(e)) return;
      if (list.includes(e.key)) { e.preventDefault(); ref.current(e); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [Array.isArray(keys) ? keys.join('|') : keys, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: '1 – 5', what: 'Go to Dashboard, Accounts, Forecast, Retirement, Settings' },
  { keys: 'N', what: 'Add an account (Accounts page)' },
  { keys: 'D', what: 'Add a debt (Accounts page)' },
  { keys: '↑ ↓ or J K', what: 'Move between accounts' },
  { keys: 'U', what: 'Update the selected account’s balance' },
  { keys: 'E', what: 'Edit the selected account' },
  { keys: 'H', what: 'Balance history of the selected account' },
  { keys: 'Delete', what: 'Delete the selected account (with undo)' },
  { keys: 'L', what: 'Add a life event (Forecast page)' },
  { keys: 'T', what: 'Switch between today’s and future dollars (Forecast page)' },
  { keys: '?', what: 'Show this list' },
];

export function GlobalShortcuts() {
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);
  const routes = ['/', '/accounts', '/projections', '/retirement', '/settings'];
  useShortcut(['1', '2', '3', '4', '5'], e => navigate(routes[Number(e.key) - 1]));
  useShortcut('?', () => setHelp(true));
  return (
    <Modal isOpen={help} onClose={() => setHelp(false)} title="Keyboard shortcuts" size="sm">
      <table className="w-full text-[14px]">
        <tbody>
          {SHORTCUTS.map(s => (
            <tr key={s.keys}>
              <td className="py-1.5 pr-4 whitespace-nowrap"><kbd className="badge badge-plain">{s.keys}</kbd></td>
              <td className="py-1.5 muted">{s.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

/* ─── Balance update reminders ──────────────────────────────────────────── */

export interface ReminderSetting { cadence: 'off' | 'monthly' | 'biweekly'; day?: number; anchor?: string }

/** The most recent date an update was due, or null when reminders are off. */
export function lastDueDate(r: ReminderSetting | undefined, today = new Date()): string | null {
  if (!r || r.cadence === 'off') return null;
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (r.cadence === 'monthly') {
    const day = Math.min(Math.max(r.day ?? 1, 1), 28);
    const d = new Date(today.getFullYear(), today.getMonth(), day);
    if (d > today) d.setMonth(d.getMonth() - 1);
    return iso(d);
  }
  const anchor = new Date((r.anchor ?? todayIso()) + 'T00:00:00');
  if (anchor > today) return null;
  const periods = Math.floor((today.getTime() - anchor.getTime()) / (14 * 86_400_000));
  return iso(new Date(anchor.getTime() + periods * 14 * 86_400_000));
}

export function ReminderBanner({ reminder, accounts }: { reminder?: ReminderSetting; accounts: any[] }) {
  const navigate = useNavigate();
  const due = lastDueDate(reminder);
  const behind = due ? accounts.filter(a => !a.last_updated || a.last_updated < due) : [];
  const key = `reminder-dismissed:${due}`;
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });

  useEffect(() => {
    try { setDismissed(localStorage.getItem(key) === '1'); } catch { /* storage unavailable */ }
  }, [key]);

  useEffect(() => {
    if (!due || behind.length === 0) return;
    const notifiedKey = `reminder-notified:${due}`;
    try {
      if (localStorage.getItem(notifiedKey)) return;
      localStorage.setItem(notifiedKey, '1');
      if ('Notification' in window && Notification.permission !== 'denied') {
        const show = () => new Notification('Time to update your balances', { body: `${behind.length} account${behind.length === 1 ? '' : 's'} not updated since ${longDate(due)}.` });
        if (Notification.permission === 'granted') show(); else Notification.requestPermission().then(p => p === 'granted' && show());
      }
    } catch { /* notifications are a nice-to-have */ }
  }, [due, behind.length]);

  if (!due || behind.length === 0 || dismissed) return null;
  const overdueDays = daysSince(due) ?? 0;
  return (
    <div className="callout callout-info mb-6 flex flex-wrap items-center gap-3">
      <Icon name="refresh" size={16} />
      <p className="flex-1">
        Time to update your balances. {behind.length} {behind.length === 1 ? 'account hasn’t' : 'accounts haven’t'} been updated since {longDate(due)}{overdueDays > 0 ? '' : ' (today)'}.
      </p>
      <button className="btn btn-sm btn-primary" onClick={() => navigate('/accounts')}>Update balances</button>
      <button className="btn btn-sm btn-ghost" onClick={() => { try { localStorage.setItem(key, '1'); } catch { /* ignore */ } setDismissed(true); }}>Not now</button>
    </div>
  );
}
