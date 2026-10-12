import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getSettings, updateSettings, refreshExchangeRates, refreshMarketPrices, getExchangeRates, exportBackup, restoreBackup,
} from '../api/client';
import { PageHeader, Panel, Loading, Icon, Segmented, ConfirmDialog } from '../components/ui';
import { useElectron } from '../contexts/ElectronContext';
import { lastDueDate } from '../components/chrome';
import { TYPE_ORDER, TYPE_DEFAULT_RETURNS, typeLabel, typeColor } from '../lib/accountTypes';
import { currencySymbol, relativeDate, longDate, todayIso } from '../lib/format';

const PRESETS: Record<string, { label: string; pct: number; note: string }> = {
  conservative:    { label: 'Cautious',  pct: 4.5,  note: 'cash, bonds' },
  moderate:        { label: 'Balanced',  pct: 7.0,  note: 'mixed funds' },
  aggressive:      { label: 'Growth',    pct: 8.0,  note: 'mostly shares' },
  very_aggressive: { label: 'High risk', pct: 15.0, note: 'crypto, single stocks' },
};

const presetFor = (pct: number) => Object.entries(PRESETS).find(([, p]) => Math.abs(p.pct - pct) < 0.01)?.[0] ?? 'custom';
const DEFAULT_RISK: Record<string, { profile: string; expected_return: number }> = Object.fromEntries(
  Object.entries(TYPE_DEFAULT_RETURNS).map(([t, pct]) => [t, { profile: presetFor(pct), expected_return: pct / 100 }]),
);

export default function SettingsPage() {
  const { profile } = useElectron();
  const [saved, setSaved] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [fxUpdated, setFxUpdated] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [restoreFile, setRestoreFile] = useState<any | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const normalise = (data: any) => ({
    ...data,
    risk_profiles: { ...DEFAULT_RISK, ...(data.risk_profiles ?? {}) },
    yahoo_finance_symbols: data.yahoo_finance_symbols ?? {},
    coingecko_ids: data.coingecko_ids ?? {},
    inflation_pct: data.inflation_pct ?? 2.5,
    target_in_todays_money: data.target_in_todays_money !== false,
    reminder: data.reminder ?? { cadence: 'off' },
  });

  useEffect(() => {
    getSettings().then(d => { const n = normalise(d ?? {}); setSaved(n); setDraft(n); }).catch(() => { setSaved({}); setDraft(normalise({})); });
    getExchangeRates().then(r => setFxUpdated(r?.last_updated ?? null)).catch(() => {});
  }, []);

  const dirty = useMemo(() => saved && draft && JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);

  if (!draft) return <Loading />;

  const set = (k: string, v: any) => setDraft((d: any) => ({ ...d, [k]: v }));
  const setRisk = (type: string, v: { profile: string; expected_return: number }) =>
    setDraft((d: any) => ({ ...d, risk_profiles: { ...d.risk_profiles, [type]: v } }));
  const setReminder = (patch: any) => set('reminder', { ...draft.reminder, ...patch });

  const currentYear = new Date().getFullYear();
  const age = draft.birth_year ? currentYear - draft.birth_year : null;
  const retireYear = draft.birth_year && draft.retirement_age ? draft.birth_year + draft.retirement_age : null;
  const cur = draft.display_currency ?? 'USD';
  const nextDue = lastDueDate(draft.reminder);

  const save = async () => {
    setBusy('save');
    try {
      await updateSettings(draft);
      setSaved(draft);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } finally { setBusy(null); }
  };

  const refresh = async (what: 'rates' | 'prices') => {
    setBusy(what);
    try {
      if (what === 'rates') { await refreshExchangeRates(); const r = await getExchangeRates(); setFxUpdated(r?.last_updated ?? null); }
      else await refreshMarketPrices();
    } catch { /* previous values stay in place */ }
    finally { setBusy(null); }
  };

  const download = async () => {
    setBusy('backup');
    try {
      const data = await exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `finance-tracker-${(profile?.name ?? 'profile').toLowerCase().replace(/\s+/g, '-')}-${todayIso()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally { setBusy(null); }
  };

  const pickRestore = async (file: File) => {
    setRestoreError(null);
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed?.app !== 'finance-tracker' || !parsed.files) throw new Error();
      setRestoreFile(parsed);
    } catch {
      setRestoreError('That file isn’t a Finance Tracker backup.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-6 pb-20">
      <PageHeader title="Settings" sub="The assumptions behind your forecast. Changes apply once you save." />

      <Panel title="You and your plan">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          <div>
            <label className="form-label" htmlFor="set-birth">Year you were born</label>
            <input id="set-birth" type="number" min={1900} max={currentYear} className="form-input" value={draft.birth_year ?? ''}
              onChange={e => set('birth_year', e.target.value === '' ? null : Number(e.target.value))} placeholder="1990" />
            <p className="form-hint">{age !== null ? `You’re ${age} this year.` : 'Needed for an accurate retirement date.'}</p>
          </div>
          <div>
            <label className="form-label" htmlFor="set-retire">Age you plan to retire</label>
            <input id="set-retire" type="number" min={30} max={99} className="form-input" value={draft.retirement_age ?? ''}
              onChange={e => set('retirement_age', e.target.value === '' ? null : Number(e.target.value))} placeholder="65" />
            {retireYear && <p className="form-hint">That’s {retireYear}. The forecast runs to this year.</p>}
          </div>
          <div>
            <label className="form-label" htmlFor="set-salary">Gross yearly income</label>
            <div className="affix"><span>{currencySymbol(cur)}</span><input id="set-salary" type="number" min={0} value={draft.salary || ''} placeholder="0"
              onChange={e => set('salary', e.target.value ? Number(e.target.value) : 0)} /></div>
            <p className="form-hint">Before tax. Used for employer matches and your savings rate.</p>
          </div>
          <div>
            <label className="form-label" htmlFor="set-target">Target net worth</label>
            <div className="affix"><span>{currencySymbol(cur)}</span><input id="set-target" type="number" min={0} value={draft.retirement_target || ''} placeholder="0"
              onChange={e => set('retirement_target', e.target.value ? Number(e.target.value) : 0)} /></div>
            <p className="form-hint">Roughly 25 times the yearly spending your savings need to cover.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Inflation" sub="Prices rise over time, so a dollar in 2050 buys less than a dollar today. The forecast can show either.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="form-label" htmlFor="set-infl">Expected inflation</label>
            <div className="affix" style={{ maxWidth: 180 }}><input id="set-infl" type="number" step={0.1} min={0} max={15} value={draft.inflation_pct}
              onChange={e => set('inflation_pct', Number(e.target.value))} /><span>% a year</span></div>
            <p className="form-hint">The US Federal Reserve and Bank of England both aim for 2%. Over the last 30 years US inflation averaged about 2.5%.</p>
          </div>
          <div>
            <span className="form-label">My target is in</span>
            <Segmented label="Target measured in" value={draft.target_in_todays_money ? 'today' : 'future'} onChange={v => set('target_in_todays_money', v === 'today')}
              options={[{ value: 'today', label: 'Today’s dollars' }, { value: 'future', label: 'Future dollars' }]} />
            <p className="form-hint">
              {draft.target_in_todays_money
                ? 'Recommended. Your target keeps its buying power, so it’s compared with the forecast after inflation.'
                : 'Your target is compared with the forecast’s raw future amounts, which flatters it the further away retirement is.'}
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="Display currency" sub="Totals and the forecast are converted into this currency. Each account keeps its own currency.">
        <Segmented label="Display currency" value={cur} onChange={v => set('display_currency', v)}
          options={['USD', 'GBP', 'EUR'].map(c => ({ value: c, label: c }))} />
      </Panel>

      <Panel title="Expected growth by account type" sub="How much each type of account is assumed to grow a year, before inflation. An account can override this from its own settings." flush>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Account type</th><th>Style</th><th className="num">Growth a year</th></tr></thead>
            <tbody>
              {TYPE_ORDER.map(t => {
                const v = draft.risk_profiles[t] ?? DEFAULT_RISK[t];
                const pct = v.expected_return * 100;
                return (
                  <tr key={t}>
                    <td><span className="inline-flex items-center gap-2"><span className="swatch" style={{ background: typeColor(t) }} />{typeLabel(t)}</span></td>
                    <td>
                      <select aria-label={`${typeLabel(t)} growth style`} className="form-input" style={{ maxWidth: 260 }}
                        value={PRESETS[v.profile] ? v.profile : 'custom'}
                        onChange={e => { const p = PRESETS[e.target.value]; if (p) setRisk(t, { profile: e.target.value, expected_return: p.pct / 100 }); }}>
                        {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}, {p.pct}% ({p.note})</option>)}
                        <option value="custom" disabled>Custom</option>
                      </select>
                    </td>
                    <td className="num">
                      <div className="affix ml-auto" style={{ width: 110 }}>
                        <input aria-label={`${typeLabel(t)} growth per year`} type="number" step={0.1} min={0} max={100} value={Number(pct.toFixed(2))}
                          onChange={e => { const n = parseFloat(e.target.value); if (!isNaN(n)) setRisk(t, { profile: presetFor(n), expected_return: n / 100 }); }} />
                        <span>%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Balance reminders" sub="A nudge to update your balances, shown in the app and as a desktop notification.">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="form-label">Remind me</span>
            <Segmented label="Reminder frequency" value={draft.reminder.cadence} onChange={v => setReminder({ cadence: v, anchor: draft.reminder.anchor ?? todayIso() })}
              options={[{ value: 'off', label: 'Never' }, { value: 'monthly', label: 'Monthly' }, { value: 'biweekly', label: 'Every payday' }]} />
          </div>
          {draft.reminder.cadence === 'monthly' && (
            <div>
              <label className="form-label" htmlFor="rem-day">On day</label>
              <input id="rem-day" type="number" min={1} max={28} className="form-input" style={{ width: 90 }} value={draft.reminder.day ?? 1} onChange={e => setReminder({ day: Number(e.target.value) })} />
            </div>
          )}
          {draft.reminder.cadence === 'biweekly' && (
            <div>
              <label className="form-label" htmlFor="rem-anchor">A recent payday</label>
              <input id="rem-anchor" type="date" className="form-input" value={draft.reminder.anchor ?? todayIso()} max={todayIso()} onChange={e => setReminder({ anchor: e.target.value })} />
            </div>
          )}
        </div>
        {nextDue && <p className="form-hint mt-3">Most recent reminder date: {longDate(nextDue)}. Accounts not updated since then are flagged.</p>}
      </Panel>

      <Panel title="Backup and restore" sub={`Your data is stored only on this computer${profile ? `, in the “${profile.name}” profile` : ''}. Keep a copy somewhere safe.`}>
        <div className="flex flex-wrap gap-3">
          <button className="btn btn-secondary" onClick={download} disabled={busy !== null}><Icon name="download" size={16} /> {busy === 'backup' ? 'Preparing…' : 'Download a backup'}</button>
          <label className="btn btn-secondary">
            Restore from a backup
            <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" onChange={e => e.target.files?.[0] && pickRestore(e.target.files[0])} />
          </label>
        </div>
        {restoreError && <p className="text-[13px] text-negative mt-3">{restoreError}</p>}
        <p className="form-hint mt-3">Accounts, debts and the forecast can also be exported as CSV from their own pages.</p>
      </Panel>

      <Panel
        title="Exchange rates"
        sub={fxUpdated ? `Last fetched ${relativeDate(fxUpdated.slice(0, 10)).toLowerCase()}. They refresh automatically while the app is open.` : 'Used to convert GBP, EUR and other balances.'}
        actions={<button className="btn btn-sm btn-secondary" onClick={() => refresh('rates')} disabled={busy !== null}><Icon name="refresh" size={15} /> {busy === 'rates' ? 'Refreshing…' : 'Refresh now'}</button>}
      >
        <p className="text-[13.5px] muted">If a conversion looks wrong, refresh the rates and reopen the page. Press <kbd className="badge badge-plain">?</kbd> anywhere to see keyboard shortcuts.</p>
      </Panel>

      <details className="panel">
        <summary className="px-5 py-4 cursor-pointer select-none section-title">Advanced: live price lookups</summary>
        <div className="px-5 pb-5 space-y-6" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="text-[13.5px] muted pt-4">Ticker mappings for fetching market prices. Your balances are entered by hand, so most people can leave these alone.</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MapEditor key={`y${resetKey}`} title="Yahoo Finance symbols" keyLabel="Holding name" valueLabel="Symbol" entries={draft.yahoo_finance_symbols} onChange={m => set('yahoo_finance_symbols', m)} />
            <MapEditor key={`c${resetKey}`} title="CoinGecko IDs" keyLabel="Coin" valueLabel="CoinGecko ID" entries={draft.coingecko_ids} onChange={m => set('coingecko_ids', m)} />
          </div>
          <button className="btn btn-sm btn-secondary" onClick={() => refresh('prices')} disabled={busy !== null}><Icon name="refresh" size={15} /> {busy === 'prices' ? 'Refreshing…' : 'Refresh market prices'}</button>
        </div>
      </details>

      {(dirty || justSaved) && (
        <div className="fixed bottom-0 inset-x-0 z-30" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border-2)', boxShadow: '0 -4px 16px rgba(20,27,36,0.06)' }}>
          <div className="max-w-[1280px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <p className="text-[14px]" style={{ color: 'var(--color-text-2)' }}>
              {dirty ? 'You have unsaved changes.' : <span className="text-positive inline-flex items-center gap-1.5"><Icon name="check" /> Settings saved. The forecast now uses them.</span>}
            </p>
            {dirty && (
              <div className="flex gap-2">
                <button className="btn btn-secondary" onClick={() => { setDraft(saved); setResetKey(k => k + 1); }} disabled={busy === 'save'}>Discard</button>
                <button className="btn btn-primary" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!restoreFile}
        title="Replace this profile’s data?"
        body={<>The backup from {restoreFile?.exported_at ? longDate(String(restoreFile.exported_at).slice(0, 10)) : 'that file'} will replace the accounts, debts, life events and settings in this profile. Download a backup of the current data first if you might want it back.</>}
        confirmLabel="Restore backup"
        onCancel={() => setRestoreFile(null)}
        onConfirm={async () => {
          try { await restoreBackup(restoreFile); window.location.assign('/'); }
          catch (err: any) { setRestoreError(err?.message ?? 'The backup couldn’t be restored.'); setRestoreFile(null); }
        }}
      />
    </div>
  );
}

function MapEditor({ title, keyLabel, valueLabel, entries, onChange }: {
  title: string; keyLabel: string; valueLabel: string; entries: Record<string, string>; onChange: (m: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(entries));
  const commit = (next: [string, string][]) => {
    setRows(next);
    const obj: Record<string, string> = {};
    next.forEach(([k, v]) => { if (k.trim()) obj[k.trim()] = v.trim(); });
    onChange(obj);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="fieldset-title">{title}</p>
        <button className="btn btn-sm btn-ghost" onClick={() => setRows(r => [...r, ['', '']])}><Icon name="plus" size={15} /> Add</button>
      </div>
      {rows.length === 0 ? <p className="text-[13px] faint">None set.</p> : (
        <div className="space-y-2">
          {rows.map(([k, v], i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center">
              <input aria-label={keyLabel} className="form-input" value={k} placeholder={keyLabel} onChange={e => commit(rows.map((r, j) => j === i ? [e.target.value, r[1]] : r))} />
              <input aria-label={valueLabel} className="form-input" value={v} placeholder={valueLabel} onChange={e => commit(rows.map((r, j) => j === i ? [r[0], e.target.value] : r))} />
              <button className="icon-btn danger" aria-label={`Remove ${k || 'row'}`} onClick={() => commit(rows.filter((_, j) => j !== i))}><Icon name="close" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
