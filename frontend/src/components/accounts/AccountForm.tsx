import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '../shared/Modal';
import { Icon, Switch } from '../ui';
import { createAccount, updateAccount } from '../../api/client';
import {
  TYPE_LABELS, TYPE_GROUPS, FREQ_OPTIONS, CURRENCIES, MATCH_TYPES, WORKPLACE_PLANS, HIGH_GROWTH_PCT,
  typeLabel, taxBucket, taxNote, TAX_LABELS, employeeContribution, employerMatch, checkLimits, LIMIT_YEAR, LIMIT_GROUPS,
} from '../../lib/accountTypes';
import { money, todayIso, currencySymbol, convert } from '../../lib/format';

const RISK_PRESETS = [
  { key: 'conservative',    label: 'Cautious',  pct: 4.5 },
  { key: 'moderate',        label: 'Balanced',  pct: 7.0 },
  { key: 'aggressive',      label: 'Growth',    pct: 8.0 },
  { key: 'very_aggressive', label: 'High risk', pct: 15.0 },
];

const EMPTY = {
  name: '', institution: '', account_number: '', account_type: '401k',
  currency: 'USD', value: '', value_date: todayIso(), notes: '',
  override_risk: false, risk_profile: 'aggressive', custom_return_pct: '8.0',
  contribution_frequency: '', contribution_amount: '', annual_lump_sum: '',
  employer_match_mode: '', employer_match_amount: '', employer_match_frequency: 'annual',
  employer_match_pct: '', employer_match_cap_pct: '',
  tax_treatment: 'pre_tax', hsa_coverage: 'self',
};
type Form = typeof EMPTY;

export interface PlanContext {
  typeReturns: Record<string, number>;
  birthYear: number | null;
  salary: number;            // display currency
  displayCurrency: string;
  rates: Record<string, number> | undefined;
  accounts: any[];
}

const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? null : n; };

/** Converts the form into the account fields the API stores. */
function toPayload(f: Form) {
  const amt = num(f.contribution_amount);
  const lump = num(f.annual_lump_sum);
  const mode = MATCH_TYPES.includes(f.account_type) ? f.employer_match_mode : '';
  return {
    name: f.name.trim(), institution: f.institution, account_number: f.account_number,
    account_type: f.account_type, currency: f.currency, notes: f.notes,
    value: num(f.value) ?? 0,
    last_updated: f.value_date || todayIso(),
    risk_profile: f.override_risk ? f.risk_profile : null,
    expected_return: f.override_risk ? (num(f.custom_return_pct) ?? 0) / 100 : null,
    contribution_frequency: f.contribution_frequency || null,
    contribution_amount: f.contribution_frequency && amt && amt > 0 ? amt : null,
    annual_lump_sum: lump && lump > 0 ? lump : null,
    employer_match_mode: mode || null,
    employer_match_amount: mode === 'fixed' ? num(f.employer_match_amount) : null,
    employer_match_frequency: mode === 'fixed' ? f.employer_match_frequency : null,
    employer_match_pct: mode === 'pct_salary' || mode === 'pct_contrib' ? num(f.employer_match_pct) : null,
    employer_match_cap_pct: mode === 'pct_contrib' ? num(f.employer_match_cap_pct) : null,
    tax_treatment: WORKPLACE_PLANS.includes(f.account_type) ? f.tax_treatment : null,
    hsa_coverage: f.account_type === 'hsa' ? f.hsa_coverage : null,
  };
}

export function AccountFormDialog({ open, account, ctx, onClose, onSaved }: {
  open: boolean; account: any | null; ctx: PlanContext; onClose: () => void; onSaved: () => void;
}) {
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNumber, setShowNumber] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null); setShowNumber(false);
    if (!account) { setForm({ ...EMPTY, currency: ctx.displayCurrency, value_date: todayIso() }); return; }
    const s = (v: any) => (v == null ? '' : String(v));
    const hasOverride = account.expected_return != null;
    setForm({
      name: account.name ?? '', institution: account.institution ?? '', account_number: account.account_number ?? '',
      account_type: account.account_type ?? 'other', currency: account.currency ?? 'USD',
      value: s(account.value ?? 0), value_date: account.last_updated ?? todayIso(), notes: account.notes ?? '',
      override_risk: hasOverride, risk_profile: account.risk_profile ?? 'aggressive',
      custom_return_pct: hasOverride ? (account.expected_return * 100).toFixed(1) : String(ctx.typeReturns[account.account_type] ?? 7),
      contribution_frequency: account.contribution_frequency ?? '', contribution_amount: s(account.contribution_amount),
      annual_lump_sum: s(account.annual_lump_sum),
      employer_match_mode: account.employer_match_mode ?? '', employer_match_amount: s(account.employer_match_amount),
      employer_match_frequency: account.employer_match_frequency ?? 'annual', employer_match_pct: s(account.employer_match_pct),
      employer_match_cap_pct: s(account.employer_match_cap_pct),
      tax_treatment: account.tax_treatment ?? 'pre_tax', hsa_coverage: account.hsa_coverage ?? 'self',
    });
  }, [open, account]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));
  const sym = currencySymbol(form.currency);
  const draft = toPayload(form);
  const salaryHere = convert(ctx.salary, ctx.displayCurrency, form.currency, ctx.rates);
  const yours = employeeContribution(draft);
  const match = employerMatch(draft, salaryHere);
  const defaultReturn = ctx.typeReturns[form.account_type] ?? 7;
  const showMatch = MATCH_TYPES.includes(form.account_type);
  const needsSalary = (form.employer_match_mode === 'pct_salary' || (form.employer_match_mode === 'pct_contrib' && num(form.employer_match_cap_pct))) && ctx.salary <= 0;

  const others = ctx.accounts.filter(a => a.id !== account?.id);
  const limits = checkLimits([...others, { ...draft, id: account?.id ?? 'draft' }], ctx.birthYear, ctx.rates, ctx.salary, ctx.displayCurrency)
    .filter(l => LIMIT_GROUPS.find(g => g.id === l.id)?.types.includes(form.account_type));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      if (account) await updateAccount(account.id, draft); else await createAccount(draft);
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? 'The account couldn’t be saved. Try again.');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="lg"
      title={account ? `Edit ${account.name}` : 'Add an account'}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-negative">{error}</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" form="account-form" className="btn btn-primary" disabled={saving || !form.name.trim()}>
              {saving ? 'Saving…' : account ? 'Save changes' : 'Add account'}
            </button>
          </div>
        </div>
      }
    >
      <form id="account-form" onSubmit={submit} className="space-y-7">
        <fieldset className="space-y-3">
          <legend className="fieldset-title mb-3">The account</legend>
          <div>
            <label className="form-label" htmlFor="acc-name">Name</label>
            <input id="acc-name" required className="form-input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="For example, Fidelity 401(k)" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="form-label" htmlFor="acc-type">Type</label>
              <select id="acc-type" className="form-input" value={form.account_type} onChange={e => set('account_type', e.target.value)}>
                {TYPE_GROUPS.map(g => (
                  <optgroup key={g.label} label={g.label}>
                    {g.types.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="acc-cur">Currency</label>
              <select id="acc-cur" className="form-input" value={form.currency} onChange={e => set('currency', e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="acc-inst">Provider</label>
              <input id="acc-inst" className="form-input" value={form.institution} onChange={e => set('institution', e.target.value)} placeholder="Optional" />
            </div>
          </div>
          {WORKPLACE_PLANS.includes(form.account_type) && (
            <div>
              <label className="form-label" htmlFor="acc-tax">Contributions go in as</label>
              <select id="acc-tax" className="form-input" style={{ maxWidth: 320 }} value={form.tax_treatment} onChange={e => set('tax_treatment', e.target.value)}>
                <option value="pre_tax">Traditional (pre-tax)</option>
                <option value="roth">Roth (after tax)</option>
              </select>
            </div>
          )}
          {form.account_type === 'hsa' && (
            <div>
              <label className="form-label" htmlFor="acc-hsa">Health plan coverage</label>
              <select id="acc-hsa" className="form-input" style={{ maxWidth: 320 }} value={form.hsa_coverage} onChange={e => set('hsa_coverage', e.target.value)}>
                <option value="self">Just me</option>
                <option value="family">Family</option>
              </select>
            </div>
          )}
          <div className="callout text-[13px]">
            <strong>{TAX_LABELS[taxBucket(form.account_type, form.tax_treatment)]}.</strong> {taxNote(form.account_type, form.tax_treatment)}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="fieldset-title mb-3">Balance</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label" htmlFor="acc-value">Current balance</label>
              <div className="affix"><span>{sym}</span><input id="acc-value" type="number" step="0.01" value={form.value} onChange={e => set('value', e.target.value)} placeholder="0.00" /></div>
            </div>
            <div>
              <label className="form-label" htmlFor="acc-date">As of</label>
              <input id="acc-date" type="date" className="form-input" value={form.value_date} max={todayIso()} onChange={e => set('value_date', e.target.value)} />
            </div>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="fieldset-title">What you put in</legend>
          <p className="form-hint" style={{ marginTop: 2 }}>Your own contributions, in {form.currency}. For a 401(k) this is usually your payroll deferral.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label" htmlFor="acc-freq">How often</label>
              <select id="acc-freq" className="form-input" value={form.contribution_frequency} onChange={e => set('contribution_frequency', e.target.value)}>
                {FREQ_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="acc-amt">Amount each time</label>
              <div className="affix" style={!form.contribution_frequency ? { opacity: 0.5 } : undefined}>
                <span>{sym}</span>
                <input id="acc-amt" type="number" step="0.01" min="0" disabled={!form.contribution_frequency} value={form.contribution_amount} onChange={e => set('contribution_amount', e.target.value)} placeholder="0.00" />
              </div>
            </div>
          </div>
          <div>
            <label className="form-label" htmlFor="acc-lump">Yearly lump sum</label>
            <div className="affix" style={{ maxWidth: 280 }}><span>{sym}</span><input id="acc-lump" type="number" step="0.01" min="0" value={form.annual_lump_sum} onChange={e => set('annual_lump_sum', e.target.value)} placeholder="0.00" /></div>
            <p className="form-hint">For example, part of a bonus you pay in once a year. Leave blank if there isn’t one.</p>
          </div>
        </fieldset>

        {showMatch && (
          <fieldset className="space-y-3">
            <legend className="fieldset-title mb-3">What your employer adds</legend>
            <div>
              <label className="form-label" htmlFor="acc-match">Employer contribution</label>
              <select id="acc-match" className="form-input" style={{ maxWidth: 380 }} value={form.employer_match_mode} onChange={e => set('employer_match_mode', e.target.value)}>
                <option value="">None</option>
                <option value="pct_contrib">A percentage of what I put in (a match)</option>
                <option value="pct_salary">A percentage of my salary</option>
                <option value="fixed">A fixed amount</option>
              </select>
            </div>
            {form.employer_match_mode === 'fixed' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label" htmlFor="acc-mamt">Amount</label>
                  <div className="affix"><span>{sym}</span><input id="acc-mamt" type="number" min="0" step="0.01" value={form.employer_match_amount} onChange={e => set('employer_match_amount', e.target.value)} placeholder="0.00" /></div>
                </div>
                <div>
                  <label className="form-label" htmlFor="acc-mfreq">Paid</label>
                  <select id="acc-mfreq" className="form-input" value={form.employer_match_frequency} onChange={e => set('employer_match_frequency', e.target.value)}>
                    <option value="monthly">Every month</option>
                    <option value="annual">Once a year</option>
                  </select>
                </div>
              </div>
            )}
            {form.employer_match_mode === 'pct_salary' && (
              <div>
                <label className="form-label" htmlFor="acc-mpct">Percentage of salary</label>
                <div className="affix" style={{ maxWidth: 160 }}><input id="acc-mpct" type="number" min="0" step="0.5" value={form.employer_match_pct} onChange={e => set('employer_match_pct', e.target.value)} placeholder="3" /><span>%</span></div>
              </div>
            )}
            {form.employer_match_mode === 'pct_contrib' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="form-label" htmlFor="acc-mpct">Employer matches</label>
                  <div className="affix"><input id="acc-mpct" type="number" min="0" step="5" value={form.employer_match_pct} onChange={e => set('employer_match_pct', e.target.value)} placeholder="100" /><span>% of what I put in</span></div>
                </div>
                <div>
                  <label className="form-label" htmlFor="acc-mcap">Up to (optional)</label>
                  <div className="affix"><input id="acc-mcap" type="number" min="0" step="0.5" value={form.employer_match_cap_pct} onChange={e => set('employer_match_cap_pct', e.target.value)} placeholder="6" /><span>% of my salary</span></div>
                </div>
              </div>
            )}
            {needsSalary && (
              <p className="callout callout-warn">This needs your salary. <button type="button" className="link-btn" onClick={() => navigate('/settings')}>Add your income in Settings</button>; until then the match counts as zero.</p>
            )}
          </fieldset>
        )}

        {(yours > 0 || match > 0) && (
          <div className="callout callout-info">
            That’s <strong className="num">{money(yours + match, form.currency)}</strong> a year into this account
            {match > 0 ? <> ({money(yours, form.currency)} from you, {money(match, form.currency)} from your employer)</> : null}.
          </div>
        )}
        {limits.map(l => (
          <div key={l.id} className="callout callout-warn flex items-start gap-2">
            <span className="mt-0.5"><Icon name="alert" size={16} /></span>
            <p>
              {l.label} would be <strong>{money(l.total, l.currency)}</strong> a year, over the {LIMIT_YEAR} limit of {money(l.limit, l.currency)}
              {l.accounts.length > 1 ? <> across {l.accounts.join(', ')}</> : null}. Anything above the limit can’t go in tax-advantaged.
            </p>
          </div>
        ))}

        <fieldset className="space-y-3">
          <legend className="fieldset-title">Expected growth</legend>
          <div className="flex items-center justify-between gap-4">
            <p className="text-[13.5px] muted">
              {form.override_risk
                ? 'Using a custom rate for this account.'
                : <>Using the {typeLabel(form.account_type)} default of <strong>{defaultReturn.toFixed(1)}% a year</strong>, set in Settings.</>}
            </p>
            <label className="flex items-center gap-2 text-[13.5px] shrink-0">
              Set my own rate
              <Switch label="Set my own rate" checked={form.override_risk}
                onChange={v => setForm(f => ({ ...f, override_risk: v, custom_return_pct: v ? String(defaultReturn) : f.custom_return_pct }))} />
            </label>
          </div>
          {form.override_risk && (
            <div className="flex flex-wrap items-center gap-2">
              {RISK_PRESETS.map(p => (
                <button key={p.key} type="button" className="chip" aria-pressed={form.risk_profile === p.key}
                  onClick={() => setForm(f => ({ ...f, risk_profile: p.key, custom_return_pct: String(p.pct) }))}>
                  {p.label} {p.pct}%
                </button>
              ))}
              <div className="affix" style={{ width: 130 }}>
                <input type="number" step="0.1" min="0" max="100" aria-label="Custom yearly growth rate" value={form.custom_return_pct}
                  onChange={e => {
                    const pct = parseFloat(e.target.value);
                    const m = RISK_PRESETS.find(p => Math.abs(p.pct - pct) < 0.05);
                    setForm(f => ({ ...f, custom_return_pct: e.target.value, risk_profile: m ? m.key : 'custom' }));
                  }} />
                <span>% a year</span>
              </div>
            </div>
          )}
          {form.override_risk && (num(form.custom_return_pct) ?? 0) > HIGH_GROWTH_PCT && (
            <p className="callout callout-warn">
              {form.custom_return_pct}% a year is far above the long-run stock market average of around 7 to 10%. Over decades it makes this account, and the whole forecast, look much bigger than it’s likely to be.
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="fieldset-title mb-3">Other details</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label" htmlFor="acc-num">Account number</label>
              <div className="affix">
                <input id="acc-num" type={showNumber ? 'text' : 'password'} autoComplete="off" value={form.account_number}
                  onChange={e => set('account_number', e.target.value)} placeholder="Optional, stored on this computer only" />
                <button type="button" className="icon-btn" style={{ borderRadius: 0, height: 'auto', width: 38 }}
                  aria-label={showNumber ? 'Hide account number' : 'Show account number'} onClick={() => setShowNumber(s => !s)}>
                  <Icon name="eye" />
                </button>
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="acc-notes">Notes</label>
              <input id="acc-notes" className="form-input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
            </div>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
