import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { profilesApi } from '../api/client';
import { useElectron } from '../contexts/ElectronContext';
import Modal from './shared/Modal';

/* ─── Layout pieces ─────────────────────────────────────────────────────── */

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title, sub, actions, children, flush = false, className = '',
}: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div>
            {title && <h2 className="section-title">{title}</h2>}
            {sub && <p className="section-sub">{sub}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      {flush ? children : <div className="panel-body">{children}</div>}
    </section>
  );
}

export function Stat({ label, value, note, tone }: {
  label: ReactNode; value: ReactNode; note?: ReactNode; tone?: 'good' | 'warn' | 'bad';
}) {
  const color = tone === 'good' ? 'var(--color-positive)' : tone === 'warn' ? 'var(--color-warning)' : tone === 'bad' ? 'var(--color-negative)' : undefined;
  return (
    <div>
      <p className="stat-label">{label}</p>
      <p className="stat-value mt-1" style={color ? { color } : undefined}>{value}</p>
      {note && <p className="stat-note">{note}</p>}
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center h-64" role="status" aria-label="Loading">
      <div className="spinner" />
    </div>
  );
}

export function EmptyState({ title, body, children }: { title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="panel px-6 py-14 text-center">
      <p className="section-title">{title}</p>
      {body && <p className="muted text-[14px] mt-1.5 mx-auto" style={{ maxWidth: '52ch' }}>{body}</p>}
      {children && <div className="flex justify-center gap-2 mt-5">{children}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />
  );
}

/* ─── Icons ─────────────────────────────────────────────────────────────── */

const PATHS = {
  edit:  'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z',
  trash: 'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0',
  close: 'M6 18L18 6M6 6l12 12',
  plus:  'M12 4.5v15m7.5-7.5h-15',
  chevron: 'M8.25 4.5l7.5 7.5-7.5 7.5',
  eye:   'M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
  refresh: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99',
  alert: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z',
  check: 'M4.5 12.75l6 6 9-13.5',
  chart: 'M3.75 3.75v16.5h16.5M7.5 15l3.75-3.75 3 3 5.25-6',
  download: 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3',
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={PATHS[name]} />
    </svg>
  );
}

/* ─── Confirm dialog ────────────────────────────────────────────────────── */

export function ConfirmDialog({
  open, title, body, confirmLabel, onConfirm, onCancel, busy = false,
}: {
  open: boolean; title: string; body: ReactNode; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  return (
    <Modal
      isOpen={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
        </div>
      }
    >
      <div className="text-[14px] muted">{body}</div>
    </Modal>
  );
}

/* ─── Combining other profiles into a forecast ─────────────────────────── */

export interface ExtraProfile { dataDir: string; label: string }

function useOtherProfiles() {
  const { profile } = useElectron();
  const [all, setAll] = useState<{ id: string; name: string; dataDir: string }[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    profilesApi.list().then((d: any) => {
      setActiveId(d.active_id ?? null);
      setAll((d.profiles ?? []).map((p: any) => ({ id: p.id, name: p.name, dataDir: p.data_dir ?? p.dataDir ?? '' })));
    }).catch(() => {});
  }, []);
  const current = profile?.id ?? activeId;
  return all.filter(p => p.id !== current);
}

export function ProfileIncluder({ selected, onChange }: {
  selected: ExtraProfile[]; onChange: (next: ExtraProfile[]) => void;
}) {
  const others = useOtherProfiles();
  const navigate = useNavigate();
  if (others.length === 0) {
    return (
      <p className="text-[13px] muted">
        Planning with a partner? <button className="link-btn" onClick={() => navigate('/profiles')}>Add their profile</button> to see a combined forecast.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] muted mr-1">Include in forecast</span>
      {others.map(p => {
        const on = selected.some(s => s.dataDir === p.dataDir);
        return (
          <button
            key={p.id}
            type="button"
            className="chip"
            aria-pressed={on}
            onClick={() => onChange(on ? selected.filter(s => s.dataDir !== p.dataDir) : [...selected, { dataDir: p.dataDir, label: p.name }])}
          >
            {on && <Icon name="check" size={14} />}
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

/** Which other profiles to include, remembered between visits and shared by Forecast and Retirement. */
export function useIncludedProfiles(): [ExtraProfile[], (next: ExtraProfile[]) => void] {
  const KEY = 'include-profiles';
  const [value, setValue] = useState<ExtraProfile[]>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
  });
  const update = (next: ExtraProfile[]) => {
    setValue(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  return [value, update];
}
