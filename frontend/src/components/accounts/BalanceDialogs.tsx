import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import Modal from '../shared/Modal';
import { Segmented, Icon } from '../ui';
import { updateAccount, updateDebt } from '../../api/client';
import { money, relativeDate, todayIso, currencySymbol, longDate } from '../../lib/format';

type Kind = 'account' | 'debt';

const valueOf = (item: any, kind: Kind) => (kind === 'debt' ? item.balance : item.value) ?? 0;
const historyOf = (item: any, kind: Kind): { date: string; value: number }[] =>
  (kind === 'debt' ? item.balance_history : item.value_history) ?? [];

/* ─── Update balance ────────────────────────────────────────────────────── */

export function UpdateBalanceDialog({ item, kind = 'account', onClose, onSaved }: {
  item: any | null; kind?: Kind; onClose: () => void; onSaved: () => void;
}) {
  const [mode, setMode] = useState<'set' | 'add'>('set');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) { setMode('set'); setAmount(''); setDate(todayIso()); setError(null); }
  }, [item]);

  if (!item) return null;
  const cur = item.currency ?? 'USD';
  const current = valueOf(item, kind);
  const n = parseFloat(amount);
  const next = isNaN(n) ? null : mode === 'set' ? n : kind === 'debt' ? current - n : current + n;
  const diff = next === null ? 0 : next - current;
  const good = kind === 'debt' ? diff <= 0 : diff >= 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next === null) return;
    setSaving(true); setError(null);
    try {
      const v = Math.max(kind === 'debt' ? 0 : -Infinity, Math.round(next * 100) / 100);
      if (kind === 'debt') await updateDebt(item.id, { balance: v, last_updated: date || todayIso() });
      else await updateAccount(item.id, { value: v, last_updated: date || todayIso() });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'The balance couldn’t be saved. Try again.');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title={`Update ${item.name}`}
      subtitle={`${kind === 'debt' ? 'Owed' : 'Currently'} ${money(current, cur, { cents: true })}, recorded ${relativeDate(item.last_updated).toLowerCase()}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-negative">{error}</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" form="balance-form" className="btn btn-primary" disabled={saving || next === null}>
              {saving ? 'Saving…' : 'Save balance'}
            </button>
          </div>
        </div>
      }
    >
      <form id="balance-form" onSubmit={save} className="space-y-4">
        <Segmented
          label="How to update"
          value={mode}
          onChange={setMode}
          options={kind === 'debt'
            ? [{ value: 'set', label: 'Enter what you owe' }, { value: 'add', label: 'Record a payment' }]
            : [{ value: 'set', label: 'Enter new balance' }, { value: 'add', label: 'Add an amount' }]}
        />
        <div>
          <label className="form-label" htmlFor="bal-amount">
            {mode === 'set'
              ? kind === 'debt' ? 'Balance owed on your statement' : 'Balance shown on your statement'
              : kind === 'debt' ? 'Amount paid off' : 'Amount to add (use a minus sign to subtract)'}
          </label>
          <div className="affix">
            <span>{currencySymbol(cur)}</span>
            <input id="bal-amount" type="number" step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" data-autofocus />
            <span>{cur}</span>
          </div>
        </div>
        <div>
          <label className="form-label" htmlFor="bal-date">Balance as of</label>
          <input id="bal-date" type="date" className="form-input" value={date} max={todayIso()} onChange={e => setDate(e.target.value)} />
          {kind === 'account' && <p className="form-hint">The forecast grows this balance forward from this date, so savings already made this year aren’t counted twice.</p>}
        </div>
        {next !== null && (
          <div className="callout flex items-baseline justify-between gap-3">
            <span>New balance <strong className="num" style={{ color: 'var(--color-text)' }}>{money(Math.max(kind === 'debt' ? 0 : next, next), cur, { cents: true })}</strong></span>
            <span className={`num ${good ? 'text-positive' : 'text-negative'}`}>{diff >= 0 ? '+' : '−'}{money(Math.abs(diff), cur, { cents: true })}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}

/* ─── History ───────────────────────────────────────────────────────────── */

export function HistoryDialog({ item, kind = 'account', onClose, onChanged }: {
  item: any | null; kind?: Kind; onClose: () => void; onChanged: () => void;
}) {
  if (!item) return null;
  const cur = item.currency ?? 'USD';
  const past = historyOf(item, kind);
  const points = [...past, ...(item.last_updated ? [{ date: item.last_updated, value: valueOf(item, kind) }] : [])]
    .sort((a, b) => a.date.localeCompare(b.date));
  const rows = [...points].reverse();

  const removeSnapshot = async (snap: { date: string; value: number }) => {
    const kept = past.filter(p => !(p.date === snap.date && p.value === snap.value));
    if (kind === 'debt') await updateDebt(item.id, { balance_history: kept });
    else await updateAccount(item.id, { value_history: kept });
    onChanged();
  };

  return (
    <Modal isOpen onClose={onClose} title={`${item.name}: balance history`} subtitle={`${points.length} recorded ${points.length === 1 ? 'balance' : 'balances'}`} size="lg">
      {points.length >= 2 ? (
        <div style={{ height: 220 }} className="mb-5">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickFormatter={d => longDate(d)} tickLine={false} minTickGap={40} />
              <YAxis tickFormatter={v => money(v as number, cur, { compact: true })} width={64} tickLine={false} axisLine={false} />
              <Tooltip labelFormatter={d => longDate(String(d))} formatter={(v: any) => [money(Number(v), cur), 'Balance']} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
              <Line type="monotone" dataKey="value" stroke={kind === 'debt' ? '#475569' : 'var(--color-accent)'} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="callout mb-5">Each time you update the balance, the old figure is kept here so you can see how it’s changed.</p>
      )}
      <table className="data-table">
        <thead><tr><th>Date</th><th className="num">Balance</th><th className="num">Change</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {rows.map((p, i) => {
            const prev = rows[i + 1];
            const change = prev ? p.value - prev.value : null;
            const isCurrent = i === 0 && !!item.last_updated;
            return (
              <tr key={`${p.date}-${i}`}>
                <td>{longDate(p.date)}{isCurrent && <span className="faint text-[12.5px]"> current</span>}</td>
                <td className="num" style={{ color: 'var(--color-text)' }}>{money(p.value, cur)}</td>
                <td className={`num ${change === null ? 'faint' : (kind === 'debt' ? change <= 0 : change >= 0) ? 'text-positive' : 'text-negative'}`}>
                  {change === null ? '–' : `${change >= 0 ? '+' : '−'}${money(Math.abs(change), cur)}`}
                </td>
                <td className="text-right">
                  {!isCurrent && (
                    <button className="icon-btn danger" aria-label={`Remove the ${longDate(p.date)} entry`} title="Remove this entry" onClick={() => removeSnapshot(p)}>
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modal>
  );
}
