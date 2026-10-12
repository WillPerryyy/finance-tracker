import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSettings, updateSettings, profilesApi } from '../api/client';
import { useElectron } from '../contexts/ElectronContext';
import { Segmented } from '../components/ui';
import { money, currencySymbol } from '../lib/format';

const STEPS = ['About you', 'Your plan', 'Your target'];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { profile, setProfile } = useElectron();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [retireAge, setRetireAge] = useState('65');
  const [salary, setSalary] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [spend, setSpend] = useState('');
  const [fixedIncome, setFixedIncome] = useState('');
  const [targetOverride, setTargetOverride] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then(s => {
      if (s?.display_currency) setCurrency(s.display_currency);
      if (s?.birth_year) setBirthYear(String(s.birth_year));
      if (s?.retirement_age) setRetireAge(String(s.retirement_age));
    }).catch(() => {});
  }, []);
  useEffect(() => { if (profile && !name && profile.name !== 'My Profile') setName(profile.name); }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const thisYear = new Date().getFullYear();
  const by = Number(birthYear);
  const validBirth = by > 1920 && by <= thisYear - 16;
  const age = validBirth ? thisYear - by : null;
  const ra = Number(retireAge);
  const validRetire = ra >= 40 && ra <= 80 && (!age || ra > age);
  const sym = currencySymbol(currency);
  const suggested = Math.max(0, (Number(spend) || 0) - (Number(fixedIncome) || 0)) * 25;
  const target = targetOverride ?? (suggested > 0 ? String(Math.round(suggested)) : '');

  async function finish(skipTarget = false) {
    setSaving(true);
    try {
      const fixed = Number(fixedIncome) > 0
        ? [{ label: currency === 'GBP' ? 'State pension' : 'Social Security', annual: String(Number(fixedIncome)), start_age: currency === 'GBP' ? 67 : 67 }]
        : undefined;
      await updateSettings({
        birth_year: validBirth ? by : null,
        retirement_age: validRetire ? ra : 65,
        salary: Number(salary) || 0,
        display_currency: currency,
        retirement_target: skipTarget ? 0 : Number(target) || 0,
        target_in_todays_money: true,
        inflation_pct: 2.5,
        onboarded: true,
        ...(fixed ? { retirement_plan: { fixed, spend: Number(spend) || null } } : {}),
      });
      if (name.trim() && profile && name.trim() !== profile.name) {
        const updated = await profilesApi.rename(profile.id, name.trim());
        setProfile({ ...profile, name: updated.name });
      }
      navigate('/accounts?start=1');
    } finally { setSaving(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-[560px]">
        <div className="flex items-center gap-3 mb-6">
          <span className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold" style={{ background: 'var(--color-nav)' }} aria-hidden="true">FT</span>
          <div>
            <h1 className="page-title" style={{ fontSize: 22 }}>Let’s set up your plan</h1>
            <p className="muted text-[14px]">Three quick questions. You can change any of this later in Settings.</p>
          </div>
        </div>

        <ol className="flex gap-2 mb-5" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <div className="h-1 rounded" style={{ background: i <= step ? 'var(--color-accent)' : 'var(--color-border-2)' }} />
              <p className={`text-[12.5px] mt-1.5 ${i === step ? 'font-semibold' : 'faint'}`} style={i === step ? { color: 'var(--color-text)' } : undefined} aria-current={i === step ? 'step' : undefined}>{s}</p>
            </li>
          ))}
        </ol>

        <form
          className="panel p-6 space-y-5"
          onSubmit={e => { e.preventDefault(); if (step < 2) setStep(step + 1); else finish(); }}
        >
          {step === 0 && (
            <>
              <div>
                <label className="form-label" htmlFor="ob-name">Your first name</label>
                <input id="ob-name" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Optional" autoFocus />
                <p className="form-hint">Shown in the top bar. Useful if you add a partner later.</p>
              </div>
              <div>
                <label className="form-label" htmlFor="ob-birth">Year you were born</label>
                <input id="ob-birth" type="number" className="form-input" style={{ maxWidth: 180 }} value={birthYear} onChange={e => setBirthYear(e.target.value)} placeholder="1994" required />
                <p className="form-hint">{age ? `You’re ${age} this year.` : 'Used to work out how many years you have until retirement and which contribution limits apply.'}</p>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <label className="form-label" htmlFor="ob-retire">Age you’d like to retire</label>
                <input id="ob-retire" type="number" className="form-input" style={{ maxWidth: 180 }} value={retireAge} onChange={e => setRetireAge(e.target.value)} required />
                <p className="form-hint">{validRetire && validBirth ? `That’s ${by + ra}, ${by + ra - thisYear} years from now.` : 'Pick an age older than you are now.'}</p>
              </div>
              <div>
                <span className="form-label">Currency for totals</span>
                <Segmented label="Currency for totals" value={currency} onChange={setCurrency} options={['USD', 'GBP', 'EUR'].map(c => ({ value: c, label: c }))} />
              </div>
              <div>
                <label className="form-label" htmlFor="ob-salary">Gross yearly income (optional)</label>
                <div className="affix" style={{ maxWidth: 260 }}>
                  <span>{sym}</span>
                  <input id="ob-salary" type="number" min={0} value={salary} onChange={e => setSalary(e.target.value)} placeholder="0" />
                </div>
                <p className="form-hint">Before tax. Used for employer matches set as a percentage of salary, and to show what share of your income you save.</p>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-[14px]" style={{ color: 'var(--color-text-2)' }}>
                Most people don’t know their number. A common rule of thumb is 25 times the yearly spending your savings need to cover.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label" htmlFor="ob-spend">Yearly spending in retirement</label>
                  <div className="affix"><span>{sym}</span><input id="ob-spend" type="number" min={0} value={spend} onChange={e => { setSpend(e.target.value); setTargetOverride(null); }} placeholder="60000" /></div>
                  <p className="form-hint">In today’s money. Try 70 to 80% of what you spend now.</p>
                </div>
                <div>
                  <label className="form-label" htmlFor="ob-fixed">{currency === 'GBP' ? 'State pension' : 'Social Security'} per year</label>
                  <div className="affix"><span>{sym}</span><input id="ob-fixed" type="number" min={0} value={fixedIncome} onChange={e => { setFixedIncome(e.target.value); setTargetOverride(null); }} placeholder="0" /></div>
                  <p className="form-hint">
                    {currency === 'GBP'
                      ? <>Check your forecast at <span className="font-semibold">gov.uk/check-state-pension</span>.</>
                      : <>Get your estimate at <span className="font-semibold">ssa.gov/myaccount</span>.</>}
                  </p>
                </div>
              </div>
              <div>
                <label className="form-label" htmlFor="ob-target">Target net worth</label>
                <div className="affix" style={{ maxWidth: 260 }}><span>{sym}</span><input id="ob-target" type="number" min={0} value={target} onChange={e => setTargetOverride(e.target.value)} placeholder="0" /></div>
                <p className="form-hint">
                  {suggested > 0 && targetOverride === null
                    ? `${money(Math.max(0, (Number(spend) || 0) - (Number(fixedIncome) || 0)), currency)} a year from savings × 25. In today’s money; the forecast adjusts for inflation.`
                    : 'In today’s money. The forecast adjusts for inflation.'}
                </p>
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-2">
            {step > 0
              ? <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>
              : <button type="button" className="btn btn-ghost" onClick={() => finish(true)} disabled={saving}>Skip setup</button>}
            <div className="flex gap-2">
              {step === 2 && <button type="button" className="btn btn-secondary" onClick={() => finish(true)} disabled={saving}>Set a target later</button>}
              <button type="submit" className="btn btn-primary" disabled={saving || (step === 0 && !validBirth) || (step === 1 && !validRetire)}>
                {step < 2 ? 'Continue' : saving ? 'Saving…' : 'Finish and add accounts'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
