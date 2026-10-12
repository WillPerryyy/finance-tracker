import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getAccounts, getDebts, getExchangeRates, getForecast, getSettings } from '../api/client';
import { Panel, Loading, EmptyState, Icon, Segmented } from '../components/ui';
import { UpdateBalanceDialog } from '../components/accounts/BalanceDialogs';
import { useToast } from '../components/chrome';
import { typeColor, typeLabel, typeRank, employeeContribution, employerMatch } from '../lib/accountTypes';
import { money, convert, daysSince, relativeDate, longDate, todayIso, STALE_AFTER_DAYS } from '../lib/format';

/** Net worth on every date a balance was recorded, carrying each item's latest known value forward. */
function netWorthTimeline(accounts: any[], debts: any[], currency: string, rates: Record<string, number> | undefined) {
  const items = [
    ...accounts.map(a => ({ cur: a.currency ?? 'USD', sign: 1, points: [...(a.value_history ?? []), ...(a.last_updated ? [{ date: a.last_updated, value: a.value ?? 0 }] : [])] })),
    ...debts.map(d => ({ cur: d.currency ?? 'USD', sign: -1, points: [...(d.balance_history ?? []), ...(d.last_updated ? [{ date: d.last_updated, value: d.balance ?? 0 }] : [])] })),
  ].map(i => ({ ...i, points: i.points.sort((a, b) => a.date.localeCompare(b.date)) }));
  const dates = [...new Set(items.flatMap(i => i.points.map(p => p.date)))].sort();
  return dates.map(date => {
    let total = 0;
    for (const i of items) {
      let latest: number | null = null;
      for (const p of i.points) { if (p.date <= date) latest = p.value; else break; }
      if (latest !== null) total += i.sign * convert(latest, i.cur, currency, rates);
    }
    return { date, total: Math.round(total) };
  });
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [rates, setRates] = useState<Record<string, number> | undefined>();
  const [settings, setSettings] = useState<any>({});
  const [forecast, setForecast] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<any | null>(null);

  const load = async () => {
    const [acc, dbt, fx, s, f] = await Promise.all([
      getAccounts().catch(() => []),
      getDebts().catch(() => []),
      getExchangeRates().catch(() => null),
      getSettings().catch(() => ({})),
      getForecast().catch(() => null),
    ]);
    setAccounts(acc ?? []); setDebts(dbt ?? []); setRates(fx?.rates); setSettings(s ?? {}); setForecast(f);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const currency = settings.display_currency ?? 'USD';
  const rows = useMemo(
    () => accounts.map(a => ({ ...a, converted: convert(a.value ?? 0, a.currency ?? 'USD', currency, rates) })),
    [accounts, rates, currency],
  );
  const timeline = useMemo(() => netWorthTimeline(accounts, debts, currency, rates), [accounts, debts, currency, rates]);

  if (loading) return <Loading />;

  if (rows.length === 0 && debts.length === 0) {
    return (
      <EmptyState title="Start by adding your accounts" body="Once your retirement accounts, investments and savings are in, this page shows your net worth, how it’s changing and whether you’re on track for retirement.">
        <button className="btn btn-primary" onClick={() => navigate('/accounts')}>Add accounts</button>
      </EmptyState>
    );
  }

  const assets = rows.reduce((s, a) => s + a.converted, 0);
  const owed = debts.reduce((s, d) => s + convert(d.balance ?? 0, d.currency ?? 'USD', currency, rates), 0);
  const net = assets - owed;
  const currencies = [...new Set([...rows.map(a => a.currency ?? 'USD'), ...debts.map(d => d.currency ?? 'USD')])];

  const byType = Object.entries(rows.reduce<Record<string, number>>((m, a) => { m[a.account_type] = (m[a.account_type] ?? 0) + a.converted; return m; }, {}))
    .filter(([, v]) => v > 0)
    .sort(([a], [b]) => typeRank(a) - typeRank(b));
  const byCurrency = Object.entries(rows.reduce<Record<string, number>>((m, a) => { m[a.currency] = (m[a.currency] ?? 0) + a.converted; return m; }, {}))
    .filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);

  const stale = rows.filter(a => (daysSince(a.last_updated) ?? Infinity) > STALE_AFTER_DAYS)
    .sort((a, b) => (daysSince(b.last_updated) ?? 1e9) - (daysSince(a.last_updated) ?? 1e9));
  const recent = [...rows].filter(a => a.last_updated).sort((a, b) => (b.last_updated ?? '').localeCompare(a.last_updated ?? '')).slice(0, 4);

  const salary = Number(settings.salary) || 0;
  const yours = rows.reduce((s, a) => s + convert(employeeContribution(a), a.currency ?? 'USD', currency, rates), 0);
  const employer = rows.reduce((s, a) => {
    const cur = a.currency ?? 'USD';
    return s + convert(employerMatch(a, convert(salary, currency, cur, rates)), cur, currency, rates);
  }, 0);

  const first = timeline[0];
  const change = timeline.length >= 2 ? net - first.total : null;

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="px-6 pt-6 pb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[14px] muted">Net worth</p>
            <p className="hero-figure mt-1">{money(net, currency)}</p>
            <p className="text-[13.5px] muted mt-2">
              {owed > 0 ? <>{money(assets, currency)} in {rows.length} accounts, minus {money(owed, currency)} of debt.</> : <>Across {rows.length} accounts.</>}
              {currencies.length > 1 && <> Converted to {currency} at today’s rates.</>}
            </p>
          </div>
          {change !== null && (
            <p className="text-[14px]">
              <span className={change >= 0 ? 'text-positive font-semibold' : 'text-negative font-semibold'}>{change >= 0 ? '+' : '−'}{money(Math.abs(change), currency)}</span>
              <span className="muted"> since {longDate(first.date)}</span>
            </p>
          )}
        </div>
        {byType.length > 0 && (
          <div className="px-6 pb-6">
            <div className="flex h-3.5 w-full gap-[2px] rounded overflow-hidden" role="img" aria-label="Accounts by type">
              {byType.map(([t, v]) => (
                <div key={t} style={{ width: `${(v / assets) * 100}%`, background: typeColor(t) }} title={`${typeLabel(t)}: ${money(v, currency)}`} />
              ))}
            </div>
            <ul className="mt-4 grid gap-x-8 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {byType.map(([t, v]) => (
                <li key={t} className="flex items-center gap-2.5 text-[13.5px]">
                  <span className="swatch" style={{ background: typeColor(t) }} />
                  <span className="flex-1" style={{ color: 'var(--color-text-2)' }}>{typeLabel(t)}</span>
                  <span className="num font-semibold" style={{ color: 'var(--color-text)' }}>{money(v, currency, { compact: true })}</span>
                  <span className="num faint w-12 text-right">{((v / assets) * 100).toFixed(1)}%</span>
                </li>
              ))}
              {owed > 0 && (
                <li className="flex items-center gap-2.5 text-[13.5px]">
                  <span className="swatch" style={{ background: typeColor('mortgage') }} />
                  <span className="flex-1" style={{ color: 'var(--color-text-2)' }}>Debts</span>
                  <span className="num font-semibold" style={{ color: 'var(--color-text)' }}>−{money(owed, currency, { compact: true })}</span>
                  <span className="w-12" />
                </li>
              )}
            </ul>
          </div>
        )}
      </section>

      <NetWorthHistory timeline={timeline} net={net} currency={currency} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RetirementOutlook forecast={forecast} onOpen={() => navigate('/projections')} onSetup={() => navigate('/settings')} />

        <Panel title="Saving" sub="What goes into your accounts each year." actions={<button className="btn btn-sm btn-secondary" onClick={() => navigate('/accounts')}>Accounts</button>}>
          <p className="stat-value">{money(yours + employer, currency)}<span className="text-[14px] font-normal muted"> a year</span></p>
          <p className="text-[14px] mt-1" style={{ color: 'var(--color-text-2)' }}>
            {money(yours, currency)} from you{employer > 0 ? <>, {money(employer, currency)} from your employer</> : null}.
          </p>
          {salary > 0 ? (
            <>
              <div className="meter mt-4"><div style={{ width: `${Math.min(100, (yours / salary) * 100)}%`, background: 'var(--color-accent)' }} /></div>
              <p className="text-[13.5px] mt-2 muted">
                You save <strong style={{ color: 'var(--color-text)' }}>{((yours / salary) * 100).toFixed(1)}%</strong> of your {money(salary, currency)} gross income
                {employer > 0 ? <>, or {(((yours + employer) / salary) * 100).toFixed(1)}% with your employer’s share</> : null}. Around 15% is a common goal.
              </p>
            </>
          ) : (
            <p className="text-[13.5px] mt-3 muted"><button className="link-btn" onClick={() => navigate('/settings')}>Add your income</button> to see what share of it you save.</p>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel
          title={stale.length > 0 ? 'Balances to update' : 'Recently updated'}
          sub={stale.length > 0 ? `${stale.length} ${stale.length === 1 ? 'account hasn’t' : 'accounts haven’t'} been updated in over ${STALE_AFTER_DAYS} days.` : 'Everything has been updated recently.'}
          actions={<button className="btn btn-sm btn-secondary" onClick={() => navigate('/accounts')}>All accounts</button>}
          flush
        >
          <ul>
            {(stale.length > 0 ? stale : recent).map(a => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                <span className="swatch" style={{ background: typeColor(a.account_type) }} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate" style={{ color: 'var(--color-text)' }}>{a.name}</p>
                  <p className="text-[12.5px] faint">Updated {relativeDate(a.last_updated).toLowerCase()}</p>
                </div>
                <span className="num text-[13.5px]" style={{ color: 'var(--color-text-2)' }}>{money(a.value ?? 0, a.currency)}</span>
                <button className={`btn btn-sm ${stale.length > 0 ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setUpdating(a)}>Update</button>
              </li>
            ))}
          </ul>
        </Panel>

        {byCurrency.length > 1 ? (
          <Panel title="Currency exposure" sub={`How much of your accounts is held in each currency, shown in ${currency}.`}>
            <ul className="space-y-3">
              {byCurrency.map(([c, v]) => (
                <li key={c} className="grid items-center gap-4 text-[13.5px]" style={{ gridTemplateColumns: '48px 1fr 110px 56px' }}>
                  <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{c}</span>
                  <div className="meter"><div style={{ width: `${(v / assets) * 100}%`, background: 'var(--color-accent)' }} /></div>
                  <span className="num text-right" style={{ color: 'var(--color-text-2)' }}>{money(v, currency)}</span>
                  <span className="num text-right faint">{((v / assets) * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : <div />}
      </div>

      <UpdateBalanceDialog item={updating} onClose={() => setUpdating(null)} onSaved={() => { setUpdating(null); load(); toast.notify('Balance updated'); }} />
    </div>
  );
}

function RetirementOutlook({ forecast, onOpen, onSetup }: { forecast: any; onOpen: () => void; onSetup: () => void }) {
  if (!forecast) return <Panel title="Retirement outlook"><p className="muted">The forecast couldn’t be loaded.</p></Panel>;
  const cur = forecast.currency ?? 'USD';
  const real = forecast.target_in_todays_money !== false;
  const target = forecast.retirement_target ?? 0;
  const now = forecast.current_total ?? 0;
  const atRetire = real ? forecast.projected_at_retirement_real : forecast.projected_at_retirement;
  const pct = target > 0 ? Math.min(100, Math.max(0, (now / target) * 100)) : 0;
  const shortfalls = forecast.warnings ?? [];

  return (
    <Panel
      title="Retirement outlook"
      sub={`Retiring at ${forecast.retirement_age} in ${forecast.retirement_year}. Figures in ${real ? 'today’s' : 'future'} dollars.`}
      actions={<button className="btn btn-sm btn-secondary" onClick={onOpen}>Open forecast</button>}
    >
      {target > 0 ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13.5px] muted">Saved toward your {money(target, cur, { compact: true })} target</span>
            <span className="num font-semibold" style={{ color: 'var(--color-text)' }}>{pct.toFixed(0)}%</span>
          </div>
          <div className="meter mt-2"><div style={{ width: `${pct}%`, background: 'var(--color-accent)' }} /></div>
          <p className="mt-4 text-[14px]" style={{ color: 'var(--color-text-2)' }}>
            {forecast.target_hit_year
              ? <>On current savings you reach your target at <strong>age {forecast.target_hit_age}</strong>, in {forecast.target_hit_year}.</>
              : <>On current savings you’d have <strong>{money(atRetire, cur, { compact: true })}</strong> at retirement, <span className="text-warning">{money(target - atRetire, cur, { compact: true })} short</span> of your target.</>}
          </p>
        </>
      ) : (
        <p className="text-[14px]" style={{ color: 'var(--color-text-2)' }}>
          On current savings you’d have <strong>{money(atRetire, cur, { compact: true })}</strong> at retirement. <button className="link-btn" onClick={onSetup}>Set a target</button> to track progress.
        </p>
      )}
      {shortfalls.length > 0 && (
        <p className="callout callout-warn mt-4 flex items-start gap-2">
          <span className="mt-0.5"><Icon name="alert" size={15} /></span>
          <span>From {shortfalls[0].year} your plan needs more than your savings can cover. <button className="link-btn" onClick={onOpen}>See the forecast</button>.</span>
        </p>
      )}
    </Panel>
  );
}

const DAY = 86_400_000;
const RANGES = [
  { value: '3m', label: '3 months', days: 91 },
  { value: '6m', label: '6 months', days: 182 },
  { value: '1y', label: '1 year', days: 365 },
  { value: '3y', label: '3 years', days: 1095 },
  { value: '5y', label: '5 years', days: 1826 },
  { value: 'all', label: 'All', days: 0 },
];

/** Net worth plotted on a true time axis, so gaps between updates show as real time. */
function NetWorthHistory({ timeline, net, currency }: { timeline: { date: string; total: number }[]; net: number; currency: string }) {
  const [range, setRange] = useState('all');
  const ts = (d: string) => new Date(d + 'T00:00:00').getTime();
  const points = useMemo(() => {
    const p = timeline.map(x => ({ t: ts(x.date), total: x.total }));
    const today = ts(todayIso());
    if (p.length && p[p.length - 1].t < today) p.push({ t: today, total: Math.round(net) });
    return p;
  }, [timeline, net]);

  if (timeline.length < 2) {
    return (
      <Panel title="Net worth over time" sub="Built from every balance you’ve recorded.">
        <p className="muted text-[14px]">This shows up after your second balance update. Today’s total is {money(net, currency)}.</p>
      </Panel>
    );
  }

  const spanDays = (points[points.length - 1].t - points[0].t) / DAY;
  const options = RANGES.filter(r => !r.days || r.days < spanDays);
  const chosen = RANGES.find(r => r.value === range) ?? RANGES[RANGES.length - 1];
  const end = points[points.length - 1].t;
  const from = chosen.days ? end - chosen.days * DAY : points[0].t;
  // Carry the last value before the window in, so the line starts at the left edge.
  const before = [...points].reverse().find(p => p.t < from);
  const visible = [...(before ? [{ t: from, total: before.total }] : []), ...points.filter(p => p.t >= from)];
  const change = visible.length >= 2 ? visible[visible.length - 1].total - visible[0].total : 0;
  const longSpan = (end - from) / DAY > 400;
  const tickFmt = (t: number) => new Date(t).toLocaleDateString('en-GB', longSpan ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });

  return (
    <Panel
      title="Net worth over time"
      sub={<>Built from every balance you’ve recorded, spaced by date. {visible.length >= 2 && <span className={change >= 0 ? 'text-positive' : 'text-negative'}>{change >= 0 ? '+' : '−'}{money(Math.abs(change), currency)}</span>} over this period.</>}
      actions={options.length > 1 ? <Segmented label="Period" value={chosen.value} onChange={setRange} options={options.map(o => ({ value: o.value, label: o.label }))} /> : undefined}
    >
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={visible} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={[from, end]} tickFormatter={tickFmt} tickLine={false} minTickGap={56} tickCount={8} />
            <YAxis tickFormatter={v => money(v as number, currency, { compact: true })} width={64} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
            <Tooltip labelFormatter={t => longDate(new Date(Number(t)).toISOString().slice(0, 10))} formatter={(v: any) => [money(Number(v), currency), 'Net worth']} contentStyle={{ borderRadius: 8, fontSize: 13 }} />
            <Area type="stepAfter" dataKey="total" stroke="var(--color-accent)" strokeWidth={2} fill="var(--color-accent)" fillOpacity={0.1} isAnimationActive={false}
              dot={visible.length <= 40 ? { r: 3, fill: 'var(--color-accent)', strokeWidth: 0 } : false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
