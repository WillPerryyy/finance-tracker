import { useEffect, useState } from 'react';
import Modal from '../shared/Modal';
import { Switch } from '../ui';
import { createDebt, updateDebt } from '../../api/client';
import { DEBT_LABELS, CURRENCIES } from '../../lib/accountTypes';
import { money, todayIso, currencySymbol } from '../../lib/format';
import { monthsToPayoff, totalInterest, payoffLabel } from '../../lib/debt';

const EMPTY = {
  name: '', lender: '', debt_type: 'student_loan', currency: 'USD', balance: '', last_updated: todayIso(),
  interest_rate: '', monthly_payment: '', redirect_when_paid: true, notes: '',
};

export function DebtFormDialog({ open, debt, displayCurrency, onClose, onSaved }: {
  open: boolean; debt: any | null; displayCurrency: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!debt) { setForm({ ...EMPTY, currency: displayCurrency, last_updated: todayIso() }); return; }
    setForm({
      name: debt.name ?? '', lender: debt.lender ?? '', debt_type: debt.debt_type ?? 'other', currency: debt.currency ?? 'USD',
      balance: String(debt.balance ?? ''), last_updated: debt.last_updated ?? todayIso(),
      interest_rate: String(debt.interest_rate ?? ''), monthly_payment: String(debt.monthly_payment ?? ''),
      redirect_when_paid: debt.redirect_when_paid !== false, notes: debt.notes ?? '',
    });
  }, [open, debt]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof EMPTY, v: any) => setForm(f => ({ ...f, [k]: v }));
  const sym = currencySymbol(form.currency);
  const bal = parseFloat(form.balance) || 0;
  const rate = parseFloat(form.interest_rate) || 0;
  const pay = parseFloat(form.monthly_payment) || 0;
  const months = monthsToPayoff(bal, rate, pay);
  const interest = totalInterest(bal, rate, pay);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    const payload = {
      name: form.name.trim(), lender: form.lender, debt_type: form.debt_type, currency: form.currency,
      balance: bal, last_updated: form.last_updated || todayIso(), interest_rate: rate, monthly_payment: pay,
      redirect_when_paid: form.redirect_when_paid, notes: form.notes,
    };
    try {
      if (debt) await updateDebt(debt.id, payload); else await createDebt(payload);
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'The debt couldn’t be saved. Try again.');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={debt ? `Edit ${debt.name}` : 'Add a debt'}
      subtitle="Debts are subtracted from your net worth and paid down in the forecast."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-negative">{error}</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" form="debt-form" className="btn btn-primary" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : debt ? 'Save changes' : 'Add debt'}
            </button>
          </div>
        </div>
      }
    >
      <form id="debt-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="form-label" htmlFor="debt-name">Name</label>
            <input id="debt-name" className="form-input" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="For example, Federal student loan" />
          </div>
          <div>
            <label className="form-label" htmlFor="debt-type">Type</label>
            <select id="debt-type" className="form-input" value={form.debt_type} onChange={e => set('debt_type', e.target.value)}>
              {Object.entries(DEBT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="form-label" htmlFor="debt-bal">Balance owed</label>
            <div className="affix"><span>{sym}</span><input id="debt-bal" type="number" min="0" step="0.01" value={form.balance} onChange={e => set('balance', e.target.value)} placeholder="0.00" /></div>
          </div>
          <div>
            <label className="form-label" htmlFor="debt-cur">Currency</label>
            <select id="debt-cur" className="form-input" value={form.currency} onChange={e => set('currency', e.target.value)}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="form-label" htmlFor="debt-rate">Interest rate</label>
            <div className="affix"><input id="debt-rate" type="number" min="0" step="0.01" value={form.interest_rate} onChange={e => set('interest_rate', e.target.value)} placeholder="6.5" /><span>% a year</span></div>
          </div>
          <div>
            <label className="form-label" htmlFor="debt-pay">Monthly payment</label>
            <div className="affix"><span>{sym}</span><input id="debt-pay" type="number" min="0" step="0.01" value={form.monthly_payment} onChange={e => set('monthly_payment', e.target.value)} placeholder="0.00" /></div>
          </div>
          <div>
            <label className="form-label" htmlFor="debt-date">Balance as of</label>
            <input id="debt-date" type="date" className="form-input" value={form.last_updated} max={todayIso()} onChange={e => set('last_updated', e.target.value)} />
          </div>
        </div>
        {bal > 0 && (
          months === null
            ? <p className="callout callout-warn">This payment doesn’t cover the interest, so the balance would keep growing.</p>
            : <p className="callout">Paid off around <strong>{payoffLabel(months)}</strong>, after about {money(interest ?? 0, form.currency)} of interest.</p>
        )}
        <div className="flex items-start justify-between gap-4 pt-1">
          <div>
            <p className="text-[14px] font-semibold" style={{ color: 'var(--color-text)' }}>Save the payment once it’s paid off</p>
            <p className="form-hint" style={{ marginTop: 2 }}>The forecast puts the freed-up {pay > 0 ? money(pay, form.currency) + ' a month' : 'payment'} into your savings.</p>
          </div>
          <Switch label="Save the payment once it’s paid off" checked={form.redirect_when_paid} onChange={v => set('redirect_when_paid', v)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="form-label" htmlFor="debt-lender">Lender</label>
            <input id="debt-lender" className="form-input" value={form.lender} onChange={e => set('lender', e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label className="form-label" htmlFor="debt-notes">Notes</label>
            <input id="debt-notes" className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
          </div>
        </div>
      </form>
    </Modal>
  );
}
