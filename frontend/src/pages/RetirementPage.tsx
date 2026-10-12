import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { getForecast, getCombinedForecast, getSettings, updateSettings } from '../api/client';
import { PageHeader, Panel, Loading, Icon, ProfileIncluder, useIncludedProfiles } from '../components/ui';
import { money, currencySymbol } from '../lib/format';
import { HIGH_GROWTH_PCT } from '../lib/accountTypes';

interface FixedIncome { label: string; annual: string; start_age?: number | string }
interface Plan {
  retire_age?: number;
  rate: number;
  growth: number;
  pre_tax_rate: number;
  gains_rate: number;
  fixed: FixedIncome[];
  pot_override?: string | null;
}

const RATES = [3, 3.5, 4, 4.5, 5, 6];
// Rates are ordered, so they share one hue that darkens as the withdrawal rate rises.
const RATE_SHADES: Record<number, string> = { 3: '#86b6ef', 3.5: '#5598e7', 4: '#2a78d6', 4.5: '#256abf', 5: '#184f95', 6: '#0d366b' };
const LIFE_END = 100;
const RMD_AGE = 73;
const RMD_FACTOR_73 = 26.5; // IRS Uniform Lifetime Table

/**
 * Pot balance in today's money, year by year from retirement, for a withdrawal of `rate`% of the
 * starting pot that rises with inflation each year (the 4% rule as Bengen defined it).
 */
function simulate(pot: number, rate: number, realGrowth: number, retireAge: number) {
  const draw = pot * rate / 100;
  const out: { age: number; balance: number }[] = [{ age: retireAge, balance: pot }];
  let bal = pot;
  let depletedAge: number | null = null;
  for (let age = retireAge + 1; age <= LIFE_END; age++) {
    bal = bal * (1 + realGrowth) - draw;
    if (bal <= 0 && depletedAge === null) depletedAge = age;
    out.push({ age, balance: Math.max(0, bal) });
  }
  return { points: out, depletedAge };
}

function defaultPlan(currency: string): Plan {
  return {
    rate: 4, growth: 5, pre_tax_rate: 15, gains_rate: 15,
    fixed: [{ label: currency === 'GBP' ? 'State pension' : 'Social Security', annual: '', start_age: 67 }],
  };
}

export default function RetirementPage() {
  const navigate = useNavigate();
  const [forecast, setForecast] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [savedNote, setSavedNote] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [extra, setExtra] = useIncludedProfiles();
  const saveTimer = useRef<number | undefined>(undefined);

  const fetchData = useCallback(async () => {
    const [f, s] = await Promise.all([
      (extra.length > 0
        ? getCombinedForecast({ extra_data_dirs: extra.map(d => d.dataDir), profile_labels: extra.map(d => d.label) })
        : getForecast()
      ).catch(() => null),
      getSettings().catch(() => ({})),
    ]);
    setForecast(f);
    setSettings(s ?? {});
    setPlan(p => p ?? { ...defaultPlan(s?.display_currency ?? 'USD'), ...(s?.retirement_plan ?? {}) });
  }, [extra]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Save the plan a moment after the last change, so it's there next time.
  const updatePlan = (patch: Partial<Plan>) => {
    setPlan(p => {
      const next = { ...(p as Plan), ...patch };
      window.clearTimeout(saveTimer.current);
      setSavedNote('saving');
      saveTimer.current = window.setTimeout(async () => {
        try { await updateSettings({ retirement_plan: next }); setSavedNote('saved'); }
        catch { setSavedNote('idle'); }
      }, 600);
      return next;
    });
  };
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const currency = forecast?.currency ?? settings?.display_currency ?? 'USD';
  const birthYear = forecast?.birth_year ?? settings?.birth_year ?? new Date().getFullYear() - 35;
  const thisYear = new Date().getFullYear();
  const currentAge = thisYear - birthYear;
  const retireAge = plan?.retire_age ?? forecast?.retirement_age ?? 65;
  const inflation = forecast?.inflation_pct ?? 2.5;

  const row = useMemo(() => {
    const rows: any[] = forecast?.forecast ?? [];
    return rows.find(r => r.year === birthYear + retireAge) ?? rows[rows.length - 1] ?? null;
  }, [forecast, birthYear, retireAge]);
  const coversAge = !!row && row.year === birthYear + retireAge;
  // Spendable savings: net worth minus the home, which isn't drawn on for income.
  const forecastPot = row ? Math.max(0, (row.total - (row.by_tax?.property ?? 0)) / (row.deflator || 1)) : 0;

  if (!forecast || !plan) return <Loading />;

  const potEdited = plan.pot_override != null && plan.pot_override !== '';
  const pot = potEdited ? Number(plan.pot_override) || 0 : forecastPot;
  const realGrowth = (1 + plan.growth / 100) / (1 + inflation / 100) - 1;
  const sym = currencySymbol(currency);
  const usLike = currency !== 'GBP';

  // Tax buckets at retirement, as shares of the pot (property isn't drawn on)
  const tax = row?.by_tax ?? {};
  const deflator = row?.deflator ?? 1;
  const bucket = (k: string) => Math.max(0, (tax[k] ?? 0) / deflator);
  const preTax = bucket('pre_tax');
  const roth = bucket('roth') + bucket('tax_free');
  const taxable = bucket('taxable') + bucket('cash');
  const drawable = preTax + roth + taxable || 1;
  const shares = { preTax: preTax / drawable, roth: roth / drawable, taxable: taxable / drawable };

  const draw = pot * plan.rate / 100;
  const activeFixed = plan.fixed.filter(f => (Number(f.annual) || 0) > 0);
  const fixedAt = (age: number) => activeFixed.filter(f => age >= (Number(f.start_age) || retireAge)).reduce((s, f) => s + Number(f.annual), 0);
  const fixedAtStart = fixedAt(retireAge);
  const fixedLater = fixedAt(LIFE_END);
  const taxOnDraw = draw * (shares.preTax * plan.pre_tax_rate / 100 + shares.taxable * 0.5 * plan.gains_rate / 100);
  const taxOnFixed = (amount: number) => amount * (usLike ? 0.85 : 1) * plan.pre_tax_rate / 100;
  const grossAtStart = draw + fixedAtStart;
  const netAtStart = grossAtStart - taxOnDraw - taxOnFixed(fixedAtStart);
  const netLater = draw + fixedLater - taxOnDraw - taxOnFixed(fixedLater);

  const { points, depletedAge } = simulate(pot, plan.rate, realGrowth, retireAge);
  const chart = points.map(p => {
    const r: Record<string, number | null> = { age: p.age };
    for (const rate of RATES) {
      const sim = simulate(pot, rate, realGrowth, retireAge);
      const b = sim.points.find(x => x.age === p.age)?.balance ?? 0;
      r[String(rate)] = b > 1 ? Math.round(b) : null;
    }
    return r;
  });
  const ticks = Array.from({ length: Math.floor((LIFE_END - retireAge) / 5) + 1 }, (_, i) => retireAge + i * 5).filter(a => a <= LIFE_END);

  const lastsLabel = (d: number | null) => (d === null ? `Past ${LIFE_END}` : `Age ${d}`);
  const tone = depletedAge === null || depletedAge >= 95 ? 'good' : depletedAge >= 85 ? 'warn' : 'bad';

  // Early access: before 59½ only taxable and cash money is freely available.
  const bridgeYears = Math.max(0, 59.5 - retireAge);
  const bridgeNeed = draw * bridgeYears;
  const bridgeHave = taxable;
  // Required minimum distributions from 73, estimated on the pre-tax share.
  const potAt73 = points.find(p => p.age === RMD_AGE)?.balance ?? 0;
  const rmd = usLike && preTax > 0 && retireAge < RMD_AGE ? (potAt73 * shares.preTax) / RMD_FACTOR_73 : 0;
  const plannedPreTaxDraw = draw * shares.preTax;
  const highGrowth = (forecast.account_series ?? []).some((s: any) => s.kind === 'asset' && s.rate_pct > HIGH_GROWTH_PCT && !String(s.key).startsWith('event:'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Retirement income"
        sub="What your savings could pay you each year once you stop working, and how long they would last. Everything here is in today’s dollars."
        actions={<span className="text-[13px] faint" aria-live="polite">{savedNote === 'saving' ? 'Saving…' : savedNote === 'saved' ? 'Your choices are saved' : ''}</span>}
      />
      <ProfileIncluder selected={extra} onChange={next => { setExtra(next); updatePlan({ pot_override: null }); }} />
      {!potEdited && highGrowth && (
        <div className="callout callout-warn flex items-start gap-2">
          <span className="mt-0.5"><Icon name="alert" size={16} /></span>
          <p>The pot comes from a forecast where at least one account grows faster than {HIGH_GROWTH_PCT}% a year, so it’s probably too high. <button className="link-btn" onClick={() => navigate('/accounts')}>Check growth rates</button>.</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[400px_minmax(0,1fr)] gap-6 items-start">
        <Panel title="Assumptions" sub="Changes save automatically.">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label" htmlFor="ret-age">Retire at age</label>
                <input id="ret-age" type="number" min={30} max={80} className="form-input" value={retireAge} onChange={e => updatePlan({ retire_age: Number(e.target.value), pot_override: null })} />
              </div>
              <div>
                <label className="form-label" htmlFor="ret-rate">Withdraw each year</label>
                <div className="affix"><input id="ret-rate" type="number" step={0.25} min={1} max={15} value={plan.rate} onChange={e => updatePlan({ rate: Number(e.target.value) })} /><span>% of pot</span></div>
              </div>
            </div>
            <p className="form-hint" style={{ marginTop: -6 }}>You’re {currentAge}, so that’s {Math.max(0, retireAge - currentAge)} years away. The withdrawal rises with inflation each year.</p>
            <div>
              <label className="form-label" htmlFor="ret-pot">Pot at retirement, today’s dollars</label>
              <div className="affix"><span>{sym}</span><input id="ret-pot" type="number" value={potEdited ? plan.pot_override ?? '' : Math.round(forecastPot)} onChange={e => updatePlan({ pot_override: e.target.value })} /></div>
              <p className="form-hint">
                {potEdited
                  ? <>Entered by you. <button type="button" className="link-btn" onClick={() => updatePlan({ pot_override: null })}>Use the forecast ({money(forecastPot, currency, { compact: true })})</button></>
                  : coversAge ? `Your forecast at age ${retireAge} in today’s dollars, net of debts and excluding your home.` : `Your forecast only runs to age ${forecast.retirement_age}. Raise the retirement age in Settings to forecast further.`}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label" htmlFor="ret-growth">Growth in retirement</label>
                <div className="affix"><input id="ret-growth" type="number" step={0.5} min={0} max={15} value={plan.growth} onChange={e => updatePlan({ growth: Number(e.target.value) })} /><span>% a year</span></div>
              </div>
              <div>
                <span className="form-label">Inflation</span>
                <p className="py-2 text-[14px]" style={{ color: 'var(--color-text-2)' }}>{inflation}% a year <button className="link-btn text-[12.5px] ml-1" onClick={() => navigate('/settings')}>Change</button></p>
              </div>
            </div>
            <p className="form-hint" style={{ marginTop: -6 }}>That’s about {(realGrowth * 100).toFixed(1)}% a year above inflation. A mix of shares and bonds has historically managed 3 to 5%.</p>
          </div>

          <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between mb-1">
              <p className="fieldset-title">Guaranteed income</p>
              <button className="btn btn-sm btn-ghost" onClick={() => updatePlan({ fixed: [...plan.fixed, { label: '', annual: '', start_age: retireAge }] })}><Icon name="plus" size={15} /> Add</button>
            </div>
            <p className="form-hint mb-3" style={{ marginTop: 0 }}>
              {usLike
                ? <>Social Security, pensions or annuities, yearly in today’s dollars. Get your Social Security estimate at <strong>ssa.gov/myaccount</strong>.</>
                : <>State pension, final-salary pensions or annuities, yearly in today’s money. Check yours at <strong>gov.uk/check-state-pension</strong>.</>}
            </p>
            <div className="space-y-2">
              {plan.fixed.map((f, i) => (
                <div key={i} className="space-y-2 pb-3" style={i < plan.fixed.length - 1 ? { borderBottom: '1px solid var(--color-border)' } : undefined}>
                  <div className="flex items-center gap-2">
                    <input aria-label="Income name" className="form-input" value={f.label} placeholder="Name"
                      onChange={e => updatePlan({ fixed: plan.fixed.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                    <button className="icon-btn danger shrink-0" aria-label={`Remove ${f.label || 'income'}`} onClick={() => updatePlan({ fixed: plan.fixed.filter((_, j) => j !== i) })}><Icon name="close" /></button>
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 150px', marginRight: 38 }}>
                    <div className="affix"><span>{sym}</span><input aria-label={`${f.label || 'Income'} per year`} type="number" min={0} value={f.annual} placeholder="0"
                      onChange={e => updatePlan({ fixed: plan.fixed.map((x, j) => j === i ? { ...x, annual: e.target.value } : x) })} /><span>a year</span></div>
                    <div className="affix"><span>from age</span><input aria-label={`${f.label || 'Income'} starts at age`} type="number" min={50} max={80} value={f.start_age ?? retireAge}
                      onChange={e => updatePlan({ fixed: plan.fixed.map((x, j) => j === i ? { ...x, start_age: Number(e.target.value) } : x) })} /></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-5 space-y-3" style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="fieldset-title">Tax in retirement</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label" htmlFor="ret-itax">Income tax rate</label>
                <div className="affix"><input id="ret-itax" type="number" step={1} min={0} max={60} value={plan.pre_tax_rate} onChange={e => updatePlan({ pre_tax_rate: Number(e.target.value) })} /><span>%</span></div>
              </div>
              <div>
                <label className="form-label" htmlFor="ret-gtax">Capital gains rate</label>
                <div className="affix"><input id="ret-gtax" type="number" step={1} min={0} max={40} value={plan.gains_rate} onChange={e => updatePlan({ gains_rate: Number(e.target.value) })} /><span>%</span></div>
              </div>
            </div>
            <p className="form-hint" style={{ marginTop: 0 }}>Your average (effective) rate, not your top bracket. Applied to pre-tax withdrawals and {usLike ? '85% of Social Security' : 'pensions'}; capital gains apply to about half of each taxable withdrawal. Roth money is tax-free.</p>
          </div>
        </Panel>

        <div className="space-y-6 min-w-0">
          {pot > 0 ? (
            <>
              <section className="panel">
                <div className="stat-row" style={{ ['--cols' as any]: 3 }}>
                  <div>
                    <p className="stat-label">Monthly income after tax</p>
                    <p className="stat-value mt-1">{money(netAtStart / 12, currency)}</p>
                    <p className="stat-note">{money(grossAtStart / 12, currency)} before tax{fixedLater > fixedAtStart ? `, rising to ${money(netLater / 12, currency)} once ${activeFixed.filter(f => (Number(f.start_age) || retireAge) > retireAge).map(f => f.label || 'income').join(' and ')} starts` : ''}</p>
                  </div>
                  <div>
                    <p className="stat-label">From your savings</p>
                    <p className="stat-value mt-1">{money(draw / 12, currency)}</p>
                    <p className="stat-note">{plan.rate}% of {money(pot, currency, { compact: true })} a year, rising with inflation</p>
                  </div>
                  <div>
                    <p className="stat-label">Savings last until</p>
                    <p className="stat-value mt-1" style={{ color: tone === 'good' ? 'var(--color-positive)' : tone === 'warn' ? 'var(--color-warning)' : 'var(--color-negative)' }}>{lastsLabel(depletedAge)}</p>
                    <p className="stat-note">{depletedAge === null ? 'Money left over at 100' : `${depletedAge - retireAge} years of withdrawals`}</p>
                  </div>
                </div>
                <p className="px-5 py-3 text-[13.5px]" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-2)' }}>
                  {depletedAge === null
                    ? `At ${plan.rate}% your savings should outlast you.`
                    : depletedAge >= 95 ? `At ${plan.rate}% your savings last until about ${depletedAge}.`
                    : depletedAge >= 85 ? `At ${plan.rate}% your savings run out around ${depletedAge}. A lower rate gives more margin.`
                    : `At ${plan.rate}% your savings run out around ${depletedAge}, which is early. Consider a lower rate or retiring later.`}
                </p>
              </section>

              {(bridgeYears > 0 || rmd > 0) && (
                <div className="space-y-2">
                  {bridgeYears > 0 && (
                    <div className={`callout ${bridgeHave >= bridgeNeed ? '' : 'callout-warn'} flex items-start gap-2`}>
                      <span className="mt-0.5"><Icon name="alert" size={16} /></span>
                      <p>
                        Retiring at {retireAge} means about {bridgeYears.toFixed(1)} years before 59½, when 401(k) and IRA withdrawals usually carry a 10% penalty.
                        You’d need around {money(bridgeNeed, currency, { compact: true })} to bridge that gap and you’re projected to have {money(bridgeHave, currency, { compact: true })} in taxable and cash accounts
                        {bridgeHave >= bridgeNeed ? ', which covers it.' : '. Options: save more in a brokerage account, use the Rule of 55 if you leave your employer in or after the year you turn 55, or take equal payments under rule 72(t).'}
                      </p>
                    </div>
                  )}
                  {rmd > 0 && (
                    <div className={`callout ${rmd > plannedPreTaxDraw ? 'callout-warn' : ''} flex items-start gap-2`}>
                      <span className="mt-0.5"><Icon name="alert" size={16} /></span>
                      <p>
                        From {RMD_AGE} the IRS requires a minimum withdrawal from pre-tax accounts each year, about {money(rmd, currency)} at first on these numbers.
                        {rmd > plannedPreTaxDraw
                          ? ` That’s more than the ${money(plannedPreTaxDraw, currency)} you’d otherwise take from them, so expect a higher tax bill then. Converting some to Roth in lower-income years before 73 can help.`
                          : ` Your planned withdrawals already cover it.`}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <Panel title="Which accounts to draw from first" sub="A common order that keeps your tax bill lower. Amounts are your projected balances at retirement." flush>
                <ol>
                  {[
                    { n: 1, title: 'Taxable accounts and cash', amount: taxable, note: 'Only the gains are taxed, at the lower capital gains rate. Lets pre-tax and Roth money keep growing.' },
                    { n: 2, title: 'Pre-tax accounts: 401(k), 403(b), traditional IRA', amount: preTax, note: `Taxed as income. Taking a steady amount each year, rather than large lumps, keeps you in a lower bracket.${usLike ? ' Required withdrawals start at 73.' : ''}` },
                    { n: 3, title: 'Roth and other tax-free accounts', amount: roth, note: 'Tax-free and with no required withdrawals, so they’re best left to grow longest or passed on.' },
                  ].map(s => (
                    <li key={s.n} className="flex items-start gap-4 px-5 py-4" style={{ borderTop: s.n > 1 ? '1px solid var(--color-border)' : undefined }}>
                      <span className="w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0" style={{ background: 'var(--color-accent-bg)', color: 'var(--color-accent-2)' }}>{s.n}</span>
                      <div className="flex-1">
                        <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{s.title}</p>
                        <p className="text-[13px] muted mt-0.5">{s.note}</p>
                      </div>
                      <span className="num font-semibold" style={{ color: 'var(--color-text)' }}>{money(s.amount, currency, { compact: true })}</span>
                    </li>
                  ))}
                </ol>
              </Panel>

              <Panel title="Compare withdrawal rates" sub={`Based on a ${money(pot, currency, { compact: true })} pot growing ${plan.growth}% a year with ${inflation}% inflation. Choose a row to use that rate.`} flush>
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr><th>Withdraw</th><th className="num">From savings a month</th><th className="num">With guaranteed income</th><th className="num">After tax</th><th className="num">Lasts until</th></tr>
                    </thead>
                    <tbody>
                      {RATES.map(r => {
                        const d = pot * r / 100;
                        const net = d + fixedAtStart - d * (shares.preTax * plan.pre_tax_rate / 100 + shares.taxable * 0.5 * plan.gains_rate / 100) - taxOnFixed(fixedAtStart);
                        const end = simulate(pot, r, realGrowth, retireAge).depletedAge;
                        const sel = r === plan.rate;
                        return (
                          <tr key={r} onClick={() => updatePlan({ rate: r })} style={{ cursor: 'pointer', background: sel ? 'var(--color-accent-bg)' : undefined }} aria-selected={sel}>
                            <td>
                              <span className="inline-flex items-center gap-2 font-semibold" style={{ color: 'var(--color-text)' }}>
                                <span className="inline-block w-3.5 h-[3px] rounded" style={{ background: RATE_SHADES[r] }} />
                                {r}%
                                {r === 4 && <span className="faint font-normal text-[12.5px]">the 4% rule</span>}
                                {sel && <span className="badge badge-info">Using</span>}
                              </span>
                            </td>
                            <td className="num">{money(d / 12, currency)}</td>
                            <td className="num">{money((d + fixedAtStart) / 12, currency)}</td>
                            <td className="num font-semibold" style={{ color: 'var(--color-text)' }}>{money(net / 12, currency)}</td>
                            <td className={`num ${end === null || end >= 95 ? 'text-positive' : end < 85 ? 'text-warning' : ''}`}>{lastsLabel(end)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          ) : (
            <div className="panel px-6 py-14 text-center">
              <p className="section-title">Enter a pot size to see your income</p>
              <p className="muted mt-1.5">Add accounts to fill this in from your forecast, or type a figure into “Pot at retirement”.</p>
            </div>
          )}
        </div>
      </div>

      {pot > 0 && (
        <Panel title="How long your savings last" sub={`Balance left in today’s dollars after each year’s withdrawal. The darker the line, the higher the withdrawal rate.`}>
          <div style={{ height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 18, right: 16, bottom: 8, left: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="age" type="number" domain={[retireAge, LIFE_END]} ticks={ticks} tickLine={false} axisLine={{ stroke: 'var(--color-border-2)' }}
                  label={{ value: 'Age', position: 'insideBottomRight', offset: -4, fontSize: 12, fill: 'var(--color-text-3)' }} />
                <YAxis tickFormatter={v => money(v as number, currency, { compact: true })} width={64} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={v => `Age ${v}`} formatter={(val: any, name: any) => [val != null ? money(Number(val), currency) : 'Run out', `Withdrawing ${name}%`]} contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 13 }} />
                {85 > retireAge && <ReferenceLine x={85} stroke="var(--color-text-4)" strokeDasharray="3 3" label={{ value: 'Age 85', fontSize: 12, fill: 'var(--color-text-3)', position: 'top' }} />}
                {95 > retireAge && <ReferenceLine x={95} stroke="var(--color-text-4)" strokeDasharray="3 3" label={{ value: 'Age 95', fontSize: 12, fill: 'var(--color-text-3)', position: 'top' }} />}
                {RATES.map(r => (
                  <Line key={r} type="monotone" dataKey={String(r)} name={String(r)} stroke={RATE_SHADES[r]}
                    strokeWidth={r === plan.rate ? 3 : 1.5} strokeOpacity={r === plan.rate ? 1 : 0.7} dot={false} connectNulls={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
            {RATES.map(r => (
              <li key={r}>
                <button type="button" className="inline-flex items-center gap-2 py-1" onClick={() => updatePlan({ rate: r })}
                  style={{ color: r === plan.rate ? 'var(--color-text)' : 'var(--color-text-3)', fontWeight: r === plan.rate ? 600 : 400 }}>
                  <span className="inline-block w-4 rounded" style={{ height: r === plan.rate ? 3 : 2, background: RATE_SHADES[r] }} />{r}%
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[12.5px] faint mt-4" style={{ maxWidth: '92ch' }}>
            A simple model: the same inflation-adjusted withdrawal every year and steady growth. Real returns vary, and a run of bad years early in retirement matters more than later ones.
            Tax figures are rough estimates using the rates you enter. The 4% rule comes from US research showing a 4% withdrawal, raised with inflation, historically lasted at least 30 years.
          </p>
        </Panel>
      )}
    </div>
  );
}
