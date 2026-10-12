import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts';
import RangeScroller, { type Range } from '../components/RangeScroller';
import {
  getForecast, getCombinedForecast, getLifeEvents, createLifeEvent, updateLifeEvent, deleteLifeEvent, getDebts, getAccounts,
} from '../api/client';

/** Account types a savings goal counts unless you choose otherwise (matches the forecast engine). */
const GOAL_DEFAULT_TYPES = ['cash', 'checking', 'brokerage', 'isa', 'other'];
import Modal from '../components/shared/Modal';
import {
  PageHeader, Panel, Loading, EmptyState, Icon, Segmented, ProfileIncluder, useIncludedProfiles,
} from '../components/ui';
import { useToast, useShortcut } from '../components/chrome';
import { typeRank, typeLabel, shadeFor, familyOf, HIGH_GROWTH_PCT, DEBT_LABELS } from '../lib/accountTypes';
import { money, currencySymbol } from '../lib/format';
import { downloadCsv } from '../lib/csv';

/* ─── Life event vocabulary ─────────────────────────────────────────────── */

const EVENT_TYPES: Record<string, { label: string; hint: string; group: string }> = {
  property_purchase:   { group: 'Home',   label: 'Buy a home',           hint: 'Pays the down payment from savings, adds the home at its full price, and adds a mortgage that’s paid down over time.' },
  down_payment_target: { group: 'Home',   label: 'Savings goal',         hint: 'Checks whether the accounts you choose reach an amount by the start of a year. Doesn’t change the forecast.' },
  child:               { group: 'Family', label: 'Have a child',         hint: 'Childcare and living costs each year, which come out of what you’d otherwise save.' },
  education:           { group: 'Family', label: 'Pay for education',    hint: 'College or school fees each year, paid from a 529 plan first if you have one.' },
  income_change:       { group: 'Work',   label: 'Change in income',     hint: 'A new job or raise that changes how much you save each year.' },
  career_break:        { group: 'Work',   label: 'Career break',         hint: 'A sabbatical or time off. Your saving pauses, then goes back to normal.' },
  semi_retirement:     { group: 'Work',   label: 'Go part-time',         hint: 'Retire in stages: save less (or nothing) from a given year.' },
  savings_change:      { group: 'Work',   label: 'Change in savings',    hint: 'Save more or less from a given year, for as long as you choose.' },
  expense:             { group: 'Money',  label: 'One-off cost',         hint: 'A wedding, car or anything else paid from savings in one year.' },
  windfall:            { group: 'Money',  label: 'Windfall',             hint: 'An inheritance, bonus or sale proceeds invested in one year.' },
  debt_payoff:         { group: 'Money',  label: 'Pay off a debt early', hint: 'Use savings to clear some or all of a debt. Its payment then goes back into savings.' },
};

const BUCKET_LABELS: Record<string, string> = {
  savings: 'Any savings (cash first)', cash: 'Savings', checking: 'Checking', brokerage: 'Brokerage', isa: 'ISA',
  '529': '529 plan', hsa: 'HSA', '401k': '401(k)', roth_ira: 'Roth IRA', alternative: 'Alternative', company_stock: 'Company stock', other: 'Other',
};

const EMPTY_EVENT = {
  type: 'property_purchase', label: '', year: new Date().getFullYear() + 3, notes: '',
  property_value: '' as string | number, down_payment: '' as string | number, funded_from: 'savings',
  mortgage_monthly: '' as string | number, mortgage_years: 30 as string | number, mortgage_rate: 6.5 as string | number,
  rent_monthly: '' as string | number, amount: '' as string | number, currency: 'USD', into_type: 'brokerage',
  new_annual_savings: '' as string | number, duration_years: '' as string | number, target_amount: '' as string | number,
  annual_cost: '' as string | number, debt_id: '', account_ids: null as string[] | null,
};
type EventForm = typeof EMPTY_EVENT;

function amortized(principal: number, ratePct: number, years: number) {
  const n = years * 12, r = ratePct / 100 / 12;
  if (n <= 0 || principal <= 0) return 0;
  return r === 0 ? principal / n : principal * r / (1 - (1 + r) ** -n);
}

function eventSummary(evt: any, cur: string, debts: any[]): string {
  const b = (k?: string | null) => (BUCKET_LABELS[k ?? 'savings'] ?? k ?? 'savings').toLowerCase();
  const dur = evt.duration_years ? ` for ${evt.duration_years} year${Number(evt.duration_years) === 1 ? '' : 's'}` : '';
  switch (evt.type) {
    case 'property_purchase': {
      const price = Number(evt.property_value || 0);
      let s = price ? `${money(price, cur)} home, ${money(Number(evt.down_payment || 0), cur)} down from ${b(evt.funded_from)}` : `${money(Number(evt.down_payment || 0), cur)} down payment`;
      if (evt.mortgage_monthly) s += `, ${money(Number(evt.mortgage_monthly), cur)} a month`;
      if (evt.rent_monthly) s += `, rent of ${money(Number(evt.rent_monthly), cur)} stops`;
      return s;
    }
    case 'down_payment_target': return `Have ${money(Number(evt.target_amount || 0), cur)} (today’s money) by the start of ${evt.year}`;
    case 'expense': return `${money(Number(evt.amount || 0), evt.currency ?? cur)} paid from ${b(evt.funded_from)}`;
    case 'windfall': return `${money(Number(evt.amount || 0), evt.currency ?? cur)} invested into ${b(evt.into_type)}`;
    case 'child': return `${money(Number(evt.annual_cost || 0), cur)} a year for ${evt.duration_years || 18} years`;
    case 'education': return `${money(Number(evt.annual_cost || 0), cur)} a year for ${evt.duration_years || 4} years, from ${b(evt.funded_from || '529')}`;
    case 'career_break': return `Save ${money(Number(evt.new_annual_savings || 0), cur)} a year${dur || ' until retirement'}`;
    case 'debt_payoff': {
      const d = debts.find(x => x.id === evt.debt_id);
      return `${evt.amount ? money(Number(evt.amount), cur) : 'Clear'} ${d ? d.name : 'a debt'} from ${b(evt.funded_from)}`;
    }
    default: return evt.new_annual_savings != null ? `Save ${money(Number(evt.new_annual_savings), cur)} a year${dur}` : '';
  }
}

/* ─── Chart series ──────────────────────────────────────────────────────── */

interface Series { key: string; name: string; color: string; type: string; debt: boolean }

function displayName(s: any) {
  if (!s.profile) return s.name;
  return s.name.toLowerCase().includes(String(s.profile).toLowerCase()) ? s.name : `${s.profile}: ${s.name}`;
}

function buildSeries(data: any, mode: 'account' | 'type'): Series[] {
  const meta: any[] = data.account_series ?? [];
  const last = (data.forecast ?? []).slice(-1)[0];
  const seen: Record<string, number> = {};
  const shadeNext = (type: string) => { const f = familyOf(type); const i = seen[f] ?? 0; seen[f] = i + 1; return shadeFor(type, i); };

  if (mode === 'type') {
    const byLabel = new Map<string, any>();
    for (const s of meta) if (s.kind === 'asset') byLabel.set(s.profile ? `${s.profile} · ${s.type_label}` : s.type_label, s);
    const keys = [...new Set((data.forecast ?? []).flatMap((r: any) => Object.keys(r.by_type ?? {})))] as string[];
    return keys
      .map(k => {
        const debt = k === 'Debts';
        const type = debt ? 'mortgage' : byLabel.get(k)?.type ?? 'other';
        return { key: `type:${k}`, name: k.replace(' · ', ': '), type, debt, color: '' };
      })
      .sort((a, b) => Number(a.debt) - Number(b.debt) || typeRank(a.type) - typeRank(b.type) || a.name.localeCompare(b.name))
      .map(s => ({ ...s, color: shadeNext(s.type) }));
  }
  return [...meta]
    .sort((a, b) => Number(a.kind === 'debt') - Number(b.kind === 'debt') || typeRank(a.type) - typeRank(b.type)
      || Math.abs(last?.by_account?.[b.key] ?? 0) - Math.abs(last?.by_account?.[a.key] ?? 0))
    .map(s => ({ key: s.key, name: displayName(s), type: s.type, debt: s.kind === 'debt', color: shadeNext(s.type) }));
}

function ForecastTooltip({ active, payload, label, series, cur, hidden, ageFor, real }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const visible = (series as Series[]).filter(s => !hidden.has(s.key) && Math.abs(row[s.key] ?? 0) >= 0.5);
  return (
    <div className="panel text-[13px]" style={{ padding: '10px 12px', minWidth: 250, boxShadow: '0 6px 20px rgba(20,27,36,0.14)' }}>
      <p className="font-semibold mb-1.5" style={{ color: 'var(--color-text)' }}>End of {label} <span className="faint font-normal">age {ageFor(label)}</span></p>
      <ul className="space-y-1">
        {visible.filter(s => !s.debt).reverse().map(s => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="swatch" style={{ background: s.color }} />
            <span className="flex-1 truncate muted">{s.name}</span>
            <span className="num" style={{ color: 'var(--color-text-2)' }}>{money(row[s.key] ?? 0, cur)}</span>
          </li>
        ))}
        {visible.filter(s => s.debt).map(s => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="swatch" style={{ background: s.color }} />
            <span className="flex-1 truncate muted">{s.name}</span>
            <span className="num text-negative">−{money(Math.abs(row[s.key] ?? 0), cur)}</span>
          </li>
        ))}
      </ul>
      <div className="flex justify-between mt-2 pt-2 font-semibold" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
        <span>Net worth</span><span className="num">{money(row.net ?? 0, cur)}</span>
      </div>
      {row.shortfall > 0 && <p className="text-warning mt-1">Short by {money(row.shortfall, cur)} this year</p>}
      <p className="faint mt-1">{real ? 'In today’s dollars' : 'In future dollars'}</p>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────── */

export default function ProjectionsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [hiddenEvents, setHiddenEvents] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [extra, setExtra] = useIncludedProfiles();
  const [mode, setMode] = useState<'account' | 'type'>('account');
  const [dollars, setDollarsState] = useState<'today' | 'future'>(() => {
    try { return (localStorage.getItem('forecast-dollars') as 'today' | 'future') || 'today'; } catch { return 'today'; }
  });
  const setDollars = (v: 'today' | 'future') => { setDollarsState(v); try { localStorage.setItem('forecast-dollars', v); } catch { /* ignore */ } };
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [everyYear, setEveryYear] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any | null>(null);
  const [form, setForm] = useState<EventForm>({ ...EMPTY_EVENT });
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [f, e, d, a] = await Promise.all([
        extra.length > 0
          ? getCombinedForecast({ extra_data_dirs: extra.map(x => x.dataDir), profile_labels: extra.map(x => x.label) })
          : getForecast(),
        getLifeEvents(),
        getDebts().catch(() => []),
        getAccounts().catch(() => []),
      ]);
      setData(f); setEvents(Array.isArray(e) ? e : []); setDebts(d ?? []); setAccounts(a ?? []);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [extra]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { setHidden(new Set()); }, [mode]);

  // Zoom: the visible slice of years (null = everything) and an in-progress drag selection.
  const [zoom, setZoom] = useState<Range | null>(null);
  const [drag, setDragState] = useState<{ a: number; b: number } | null>(null);
  // Mirrors `drag` so mouse-up sees the latest selection even before React re-renders.
  const dragRef = useRef<{ a: number; b: number } | null>(null);
  const setDrag = (d: { a: number; b: number } | null) => { dragRef.current = d; setDragState(d); };
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const hoverIndex = useRef<number | null>(null);
  const wheelHandler = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    const el = chartBoxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelHandler.current(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const series = useMemo(() => (data ? buildSeries(data, mode) : []), [data, mode]);
  useShortcut('l', () => openAdd());
  useShortcut('t', () => setDollars(dollars === 'today' ? 'future' : 'today'));

  if (loading) return <Loading />;

  if (!data || (!data.current_assets && !data.current_debts)) {
    return (
      <div>
        <PageHeader title="Forecast" />
        <EmptyState title="Nothing to forecast yet" body="Add your accounts with today’s balances and what you pay into them. The forecast then projects each one forward to retirement.">
          <button className="btn btn-primary" onClick={() => navigate('/accounts')}>Add accounts</button>
        </EmptyState>
      </div>
    );
  }

  const cur: string = data.currency ?? 'USD';
  const real = dollars === 'today';
  const forecast: any[] = data.forecast ?? [];
  const history: { year: number; total: number }[] = data.history ?? [];
  const target = data.retirement_target ?? 0;
  const targetReal = data.target_in_todays_money !== false;
  const retireYear = data.retirement_year;
  const retireAge = data.retirement_age;
  const currentYear = new Date().getFullYear();
  const ageFor = (y: number) => y - data.birth_year;
  const goals: any[] = data.savings_target_results ?? [];
  const goalById = new Map(goals.map(g => [g.id, g]));
  const warnings: any[] = data.warnings ?? [];
  const lastRow = forecast[forecast.length - 1];

  const scale = (row: any, v: number) => (real ? v / (row.deflator || 1) : v);
  const targetFor = (row: any) => (targetReal ? (real ? target : target * row.deflator) : (real ? target / row.deflator : target));
  const rawValue = (row: any, s: Series) => (mode === 'account' ? row.by_account?.[s.key] ?? 0 : row.by_type?.[s.key.slice(5)] ?? 0);
  const valueOf = (row: any, s: Series) => scale(row, rawValue(row, s));

  const historyMap = new Map(history.map(h => [h.year, h.total]));
  const showRecorded = history.length >= 2;
  const chartDataAll = forecast.map(row => {
    const out: Record<string, number | null> = {
      year: row.year,
      net: scale(row, row.total),
      shortfall: scale(row, row.shortfall || 0),
      target: target > 0 ? targetFor(row) : null,
      actual: showRecorded ? historyMap.get(row.year) ?? null : null,
    };
    for (const s of series) {
      const v = valueOf(row, s);
      // A debt at zero (not taken out yet, or paid off) is left out, otherwise it stacks on top of the assets.
      out[s.key] = s.debt && Math.abs(v) < 0.5 ? null : v;
    }
    return out;
  });

  /* ── Zoom ── */
  const lastIdx = Math.max(1, chartDataAll.length - 1);
  const clampRange = (r: Range): Range => {
    const span = Math.max(2, Math.min(lastIdx, r.end - r.start));
    const start = Math.max(0, Math.min(lastIdx - span, r.start));
    return { start, end: start + span };
  };
  const range: Range = zoom ? clampRange(zoom) : { start: 0, end: lastIdx };
  const chartData = chartDataAll.slice(range.start, range.end + 1);
  const zoomed = range.start > 0 || range.end < lastIdx;
  const zoomBy = (factor: number) => {
    const span = range.end - range.start;
    const centre = hoverIndex.current ?? Math.round((range.start + range.end) / 2);
    const nextSpan = Math.max(2, Math.round(span * factor));
    if (nextSpan >= lastIdx) { setZoom(null); return; }
    const ratio = span > 0 ? (centre - range.start) / span : 0.5;
    const start = Math.round(centre - nextSpan * ratio);
    setZoom(clampRange({ start, end: start + nextSpan }));
  };
  const panBy = (steps: number) => setZoom(clampRange({ start: range.start + steps, end: range.end + steps }));
  wheelHandler.current = (e: WheelEvent) => {
    if (e.ctrlKey) { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.25 : 0.8); }
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      const d = e.shiftKey ? e.deltaY : e.deltaX;
      panBy(Math.sign(d) * Math.max(1, Math.round((range.end - range.start) * 0.1)));
    }
  };
  const PRESETS = [
    { value: '5', label: 'Next 5 years', years: 5 },
    { value: '10', label: '10 years', years: 10 },
    { value: '20', label: '20 years', years: 20 },
    { value: 'all', label: 'All', years: 0 },
  ].filter(p => !p.years || p.years < lastIdx);
  const activePreset = !zoomed ? 'all' : range.start === 0 ? PRESETS.find(p => p.years === range.end)?.value ?? 'custom' : 'custom';
  // Which year is under the pointer, worked out from its position over the plot area
  // (the y axis takes the first 72px, the right margin 16px).
  const indexFromEvent = (ev: any): number | null => {
    const box = chartBoxRef.current;
    const x = ev?.clientX ?? ev?.nativeEvent?.clientX;
    if (!box || x == null) return null;
    const rect = box.getBoundingClientRect();
    const left = rect.left + 72, width = rect.width - 72 - 16;
    if (width <= 0) return null;
    const frac = Math.min(1, Math.max(0, (x - left) / width));
    return range.start + Math.round(frac * (range.end - range.start));
  };

  // Fit the y axis to what's visible. The target line only stretches it when it's close to the data,
  // otherwise zooming into early years would leave everything squashed at the bottom.
  const sortedEvents = events.filter(e => !hiddenEvents.has(e.id)).sort((a, b) => a.year - b.year);
  const chartEvents = sortedEvents.filter(e => e.type !== 'down_payment_target');

  // Event labels sit on rows; one that would run into its neighbour drops to the next row.
  const eventRows = (() => {
    const span = Math.max(1, range.end - range.start);
    const pxPerYear = 1150 / span;
    const rowEnds: number[] = [];
    return [...chartEvents].sort((a, b) => a.year - b.year).map(evt => {
      const x = evt.year * pxPerYear;
      const width = evt.label.length * 6.4 + 12;
      let row = rowEnds.findIndex(end => x >= end);
      if (row === -1) { row = rowEnds.length; rowEnds.push(0); }
      rowEnds[row] = x + width;
      return { evt, row };
    });
  })();

  const yDomain = (() => {
    let lo = 0, hi = 0, targetHi = 0;
    for (const row of chartData) {
      let pos = 0, neg = 0;
      for (const sr of series) {
        if (hidden.has(sr.key)) continue;
        const v = Number(row[sr.key]) || 0;
        if (v >= 0) pos += v; else neg += v;
      }
      hi = Math.max(hi, pos, Number(row.net) || 0, Number(row.actual) || 0);
      lo = Math.min(lo, neg, Number(row.net) || 0);
      targetHi = Math.max(targetHi, Number(row.target) || 0);
    }
    if (targetHi > 0 && targetHi <= hi * 1.5) hi = Math.max(hi, targetHi);
    // Round out to a clean step (1, 2, 2.5 or 5 times a power of ten) with about five gridlines.
    const raw = Math.max(1, (hi - lo) / 5);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st >= raw) ?? raw;
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil((hi * 1.02) / step) * step;
    const ticks: number[] = [];
    for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.round(t));
    return { domain: [min, max] as [number, number], ticks };
  })();

  const now = data.current_total ?? 0;
  const atRetire = lastRow ? scale(lastRow, lastRow.total) : 0;
  const toggle = (key: string) => setHidden(h => { const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const tableRows = forecast.filter(r => everyYear || r.year === currentYear || r.year % 5 === 0 || r.year === retireYear);
  const highGrowth = (data.account_series ?? []).filter((s: any) => s.kind === 'asset' && s.rate_pct > HIGH_GROWTH_PCT && !s.key.startsWith('event:'));
  const totalShort = warnings.reduce((s, w) => s + w.shortfall, 0);
  const pctSaved = target > 0 ? Math.min(100, Math.max(0, (now / target) * 100)) : 0;

  /* ── Event form ── */
  function openAdd() {
    setEditingEvent(null);
    setForm({ ...EMPTY_EVENT, currency: cur });
    setModalOpen(true);
  }
  function openEdit(evt: any) {
    setEditingEvent(evt);
    setForm({ ...EMPTY_EVENT, ...Object.fromEntries(Object.entries(evt).filter(([, v]) => v != null)) } as EventForm);
    setModalOpen(true);
  }
  const set = (k: keyof EventForm, v: any) => setForm(f => ({ ...f, [k]: v }));
  const n = (v: any) => (v !== '' && v != null ? Number(v) : null);

  async function handleSave() {
    setSaving(true);
    try {
      const f = form;
      const base: Record<string, any> = { type: f.type, label: f.label, year: Number(f.year), notes: f.notes };
      const fields: Record<string, any> = {
        property_purchase: { property_value: n(f.property_value), down_payment: n(f.down_payment), funded_from: f.funded_from, mortgage_monthly: n(f.mortgage_monthly), mortgage_years: n(f.mortgage_years), mortgage_rate: n(f.mortgage_rate), rent_monthly: n(f.rent_monthly) },
        down_payment_target: { target_amount: n(f.target_amount), account_ids: f.account_ids && f.account_ids.length ? f.account_ids : null },
        expense: { amount: n(f.amount), funded_from: f.funded_from, currency: f.currency },
        windfall: { amount: n(f.amount), into_type: f.into_type, currency: f.currency },
        child: { annual_cost: n(f.annual_cost), duration_years: n(f.duration_years) ?? 18 },
        education: { annual_cost: n(f.annual_cost), duration_years: n(f.duration_years) ?? 4, funded_from: f.funded_from === 'savings' ? '529' : f.funded_from },
        career_break: { new_annual_savings: n(f.new_annual_savings) ?? 0, duration_years: n(f.duration_years) ?? 1 },
        semi_retirement: { new_annual_savings: n(f.new_annual_savings) ?? 0, duration_years: null },
        income_change: { new_annual_savings: n(f.new_annual_savings), duration_years: n(f.duration_years) },
        savings_change: { new_annual_savings: n(f.new_annual_savings), duration_years: n(f.duration_years) },
        debt_payoff: { debt_id: f.debt_id || null, amount: n(f.amount), funded_from: f.funded_from },
      }[f.type] ?? {};
      if (editingEvent) await updateLifeEvent(editingEvent.id, { ...base, ...fields });
      else await createLifeEvent({ ...base, ...fields });
      setModalOpen(false);
      toast.notify(editingEvent ? 'Life event saved' : 'Life event added');
      reload();
    } finally { setSaving(false); }
  }

  function removeEvent(evt: any) {
    setHiddenEvents(h => new Set(h).add(evt.id));
    const unhide = () => setHiddenEvents(h => { const x = new Set(h); x.delete(evt.id); return x; });
    toast.undoable({
      message: `Deleted ${evt.label || 'life event'}`,
      commit: async () => { await deleteLifeEvent(evt.id); await reload(); unhide(); },
      onUndo: unhide,
    });
  }

  const exportCsv = () => downloadCsv(`forecast-${real ? 'todays' : 'future'}-dollars.csv`, [
    ['Year', 'Age', ...series.map(s => s.name), 'Net worth', 'Shortfall'],
    ...forecast.map(r => [r.year, r.age, ...series.map(s => Math.round(valueOf(r, s))), Math.round(scale(r, r.total)), Math.round(scale(r, r.shortfall || 0))]),
  ]);

  const sym = currencySymbol(cur);
  const price = Number(form.property_value) || 0;
  const dp = Number(form.down_payment) || 0;
  const suggestedMortgage = amortized(Math.max(0, price - dp), Number(form.mortgage_rate) || 0, Number(form.mortgage_years) || 0);
  const savingsNow = data.employee_savings ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forecast"
        sub="Where each account is heading if you keep saving what you save today. Growth rates, inflation and your target live in Settings."
        actions={
          <>
            <Segmented label="Show amounts in" value={dollars} onChange={setDollars}
              options={[{ value: 'today', label: 'Today’s dollars' }, { value: 'future', label: 'Future dollars' }]} />
            <button className="btn btn-secondary" onClick={() => navigate('/settings')}>Change assumptions</button>
          </>
        }
      />

      <ProfileIncluder selected={extra} onChange={setExtra} />

      {(data.assumed ?? []).includes('birth_year') && (
        <div className="callout callout-warn flex items-start gap-2">
          <span className="mt-0.5"><Icon name="alert" size={16} /></span>
          <p>Your birth year isn’t set, so the forecast assumes you’re 35. <button className="link-btn" onClick={() => navigate('/settings')}>Add it in Settings</button> for an accurate retirement date.</p>
        </div>
      )}
      {highGrowth.length > 0 && (
        <div className="callout callout-warn flex items-start gap-2">
          <span className="mt-0.5"><Icon name="alert" size={16} /></span>
          <p>
            {highGrowth.map((s: any) => `${displayName(s)} (${s.rate_pct}%)`).join(', ')} {highGrowth.length === 1 ? 'is' : 'are'} set to grow faster than {HIGH_GROWTH_PCT}% a year, well above typical long-run returns, so the forecast is likely too optimistic.{' '}
            <button className="link-btn" onClick={() => navigate('/accounts')}>Review on Accounts</button>
          </p>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="callout callout-warn flex items-start gap-2">
          <span className="mt-0.5"><Icon name="alert" size={16} /></span>
          <p>
            From {warnings[0].year} your plan needs more money than your savings can provide, about {money(warnings[0].shortfall, cur)} in the first year and {money(totalShort, cur, { compact: true })} in total (future dollars).
            No account is allowed to go below zero, so these costs are left unpaid in the forecast. Saving more, moving a life event later or lowering its cost would close the gap.
          </p>
        </div>
      )}

      {/* Headline figures */}
      <section className="panel">
        <div className="stat-row" style={{ ['--cols' as any]: 4 }}>
          <div>
            <p className="stat-label">Net worth today</p>
            <p className="stat-value mt-1">{money(now, cur)}</p>
            <p className="stat-note">Age {ageFor(currentYear)}{data.current_debts > 0 ? `, after ${money(data.current_debts, cur, { compact: true })} of debt` : ''}</p>
          </div>
          <div>
            <p className="stat-label">At retirement</p>
            <p className="stat-value mt-1">{money(atRetire, cur)}</p>
            <p className="stat-note">Age {retireAge} in {retireYear}, {real ? 'today’s' : 'future'} dollars</p>
          </div>
          <div>
            <p className="stat-label">Saving each year</p>
            <p className="stat-value mt-1">{data.annual_savings > 0 ? money(data.annual_savings, cur) : 'Nothing set'}</p>
            <p className="stat-note">{data.employer_match > 0 ? `${money(data.employer_match, cur)} of it from your employer` : data.annual_savings > 0 ? `${money(data.annual_savings / 12, cur)} a month` : 'Add contributions on the Accounts page'}</p>
          </div>
          <div>
            <p className="stat-label">Target reached</p>
            {target > 0 ? (
              data.target_hit_year
                ? <><p className="stat-value mt-1" style={{ color: 'var(--color-positive)' }}>Age {data.target_hit_age}</p><p className="stat-note">In {data.target_hit_year}, {data.target_hit_year - currentYear} years from now</p></>
                : <><p className="stat-value mt-1" style={{ color: 'var(--color-warning)' }}>Not by {retireAge}</p><p className="stat-note">{money(Math.max(0, target - (targetReal ? data.projected_at_retirement_real : data.projected_at_retirement)), cur, { compact: true })} short{targetReal ? ' in today’s dollars' : ''}</p></>
            ) : (
              <><p className="stat-value mt-1 faint">No target</p><p className="stat-note"><button className="link-btn" onClick={() => navigate('/settings')}>Set one in Settings</button></p></>
            )}
          </div>
        </div>
        {target > 0 && (
          <div className="px-5 py-4" style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="text-[13px] muted mb-1.5">{pctSaved.toFixed(1)}% of your {money(target, cur)} target saved so far{targetReal ? ' (target in today’s dollars)' : ''}</p>
            <div className="meter"><div style={{ width: `${pctSaved}%`, background: 'var(--color-accent)' }} /></div>
          </div>
        )}
      </section>

      {goals.length > 0 && (
        <Panel title="Savings goals" sub={`Measured at the start of each goal’s year, so the money is there before anything you buy that year. In ${real ? 'today’s' : 'future'} dollars.`} flush>
          <ul>
            {goals.map(g => {
              const have = real ? g.projected_today : g.projected_liquid;
              const need = real ? g.target_today : g.target;
              const short = Math.max(0, need - have);
              const pct = need > 0 ? Math.min(100, (have / need) * 100) : 0;
              const yearsLeft = Math.max(1, g.year - currentYear);
              const perMonth = (g.shortfall / (g.deflator || 1)) / yearsLeft / 12;
              const fast = (g.accounts ?? []).filter((a: any) => a.rate_pct > HIGH_GROWTH_PCT);
              const evt = events.find(e => e.id === g.id);
              return (
                <li key={g.id} className="grid items-start gap-4 px-5 py-4" style={{ gridTemplateColumns: 'minmax(170px, 1.1fr) 2.2fr auto', borderTop: '1px solid var(--color-border)' }}>
                  <div>
                    <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{g.label}</p>
                    <p className="text-[12.5px] faint">By the start of {g.year}</p>
                  </div>
                  <div>
                    <div className="meter mt-1.5"><div style={{ width: `${pct}%`, background: g.on_track ? 'var(--color-positive)' : 'var(--color-warning)' }} /></div>
                    <p className="text-[13px] mt-1.5" style={{ color: 'var(--color-text-2)' }}>
                      <strong className="num">{money(have, cur)}</strong> projected of <strong className="num">{money(need, cur)}</strong>
                      {!real && <span className="faint"> ({money(g.target_today, cur)} in today’s money)</span>}
                    </p>
                    <p className="text-[12.5px] muted mt-0.5">
                      Counting {(g.accounts ?? []).length === 0 ? 'no accounts' : (g.accounts ?? []).map((a: any) => a.name).join(', ')}
                      {g.default_accounts ? ' (your savings, checking and brokerage accounts)' : ''}.{' '}
                      {evt && <button className="link-btn" onClick={() => openEdit(evt)}>Choose accounts</button>}
                    </p>
                    {!g.on_track && (
                      <p className="text-[12.5px] muted mt-0.5">Saving about {money(Math.ceil(perMonth / 10) * 10, cur)} more a month (today’s money) into these accounts would close the gap.</p>
                    )}
                    {fast.length > 0 && (
                      <p className="text-[12.5px] text-warning mt-0.5">{fast.map((a: any) => `${a.name} is set to grow ${a.rate_pct}% a year`).join('; ')}, so this projection is likely too high.</p>
                    )}
                  </div>
                  {g.on_track
                    ? <span className="badge badge-good"><Icon name="check" size={13} /> On track</span>
                    : <span className="badge badge-warn">{money(short, cur, { compact: true })} short</span>}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {/* Chart */}
      <Panel
        title={mode === 'account' ? 'Projected balance by account' : 'Projected balance by account type'}
        sub={`Stacked, in ${real ? 'today’s' : 'future'} ${cur}. Debts sit below the line; the dark line is your net worth. Click a name to hide or show it.`}
        actions={
          <Segmented label="Break down by" value={mode} onChange={setMode}
            options={[{ value: 'account', label: 'Accounts' }, { value: 'type', label: 'Types' }]} />
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <Segmented label="Years shown" value={activePreset}
            onChange={v => { const p = PRESETS.find(x => x.value === v); setZoom(!p || !p.years ? null : { start: 0, end: p.years }); }}
            options={PRESETS.map(p => ({ value: p.value, label: p.label }))} />
          <div className="flex items-center gap-1">
            <span className="text-[13px] muted mr-2 num">{chartDataAll[range.start]?.year} to {chartDataAll[range.end]?.year}</span>
            <button className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1.5)} disabled={!zoomed}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M20 20l-4-4" strokeLinecap="round" /></svg>
            </button>
            <button className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(0.66)} disabled={range.end - range.start <= 2}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M20 20l-4-4" strokeLinecap="round" /></svg>
            </button>
            {zoomed && <button className="btn btn-sm btn-ghost" onClick={() => setZoom(null)}>Reset</button>}
          </div>
        </div>
        <div ref={chartBoxRef} className="select-none" style={{ height: 400, cursor: drag ? 'col-resize' : 'crosshair' }} onMouseLeave={() => { hoverIndex.current = null; setDrag(null); }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              stackOffset="sign"
              margin={{ top: 18, right: 16, bottom: 0, left: 4 }}
              onMouseDown={(_: any, ev: any) => { const i = indexFromEvent(ev); if (i !== null) setDrag({ a: i, b: i }); }}
              onMouseMove={(_: any, ev: any) => {
                const i = indexFromEvent(ev);
                hoverIndex.current = i;
                const d = dragRef.current;
                if (d && i !== null && i !== d.b) setDrag({ ...d, b: i });
              }}
              onMouseUp={(_: any, ev: any) => {
                const d = dragRef.current;
                const i = indexFromEvent(ev);
                const b = i ?? d?.b;
                if (d && b != null && Math.abs(b - d.a) >= 2) setZoom({ start: Math.min(d.a, b), end: Math.max(d.a, b) });
                setDrag(null);
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="year" tickLine={false} axisLine={{ stroke: 'var(--color-border-2)' }} minTickGap={24} />
              <YAxis tickFormatter={v => money(v as number, cur, { compact: true })} width={68} tickLine={false} axisLine={false} domain={yDomain.domain} ticks={yDomain.ticks} allowDataOverflow />
              <Tooltip content={<ForecastTooltip series={series} cur={cur} hidden={hidden} ageFor={ageFor} real={real} />} cursor={{ stroke: 'var(--color-text-4)', strokeWidth: 1 }} />
              <ReferenceLine y={0} stroke="var(--color-border-2)" />
              {series.filter(s => !hidden.has(s.key)).map(s => (
                <Area key={s.key} type="linear" dataKey={s.key} name={s.name} stackId="forecast"
                  fill={s.color} fillOpacity={s.debt ? 0.75 : 0.92} stroke="var(--color-surface)" strokeWidth={1.5}
                  isAnimationActive={false} activeDot={false} />
              ))}
              <Line type="linear" dataKey="net" name="Net worth" stroke="var(--color-text)" strokeWidth={2} dot={false} isAnimationActive={false} />
              {target > 0 && (
                <Line type="linear" dataKey="target" name="Target" stroke="var(--color-text-2)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              )}
              {showRecorded && (
                <Line type="monotone" dataKey="actual" name="Recorded" stroke="var(--color-accent)" strokeWidth={0}
                  dot={{ r: 4, fill: 'var(--color-accent)', stroke: 'var(--color-surface)', strokeWidth: 2 }} isAnimationActive={false} />
              )}
              <ReferenceLine x={retireYear} stroke="var(--color-text-2)" strokeDasharray="4 3"
                label={{ value: `Retire at ${retireAge}`, position: 'insideTopRight', fontSize: 12, fill: 'var(--color-text-2)' }} />
              {eventRows.map(({ evt, row }) => (
                <ReferenceLine key={evt.id} x={evt.year} stroke="var(--color-text-4)" strokeDasharray="2 3"
                  label={(p: any) => (
                    <text x={(p.viewBox?.x ?? 0) + 4} y={(p.viewBox?.y ?? 0) + 12 + row * 15} fontSize={11} fill="var(--color-text-3)">{evt.label}</text>
                  )} />
              ))}
              {warnings.length > 0 && (
                <ReferenceLine x={warnings[0].year} stroke="var(--color-warning)" strokeWidth={1.5}
                  label={{ value: 'Shortfall starts', position: 'insideBottomLeft', fontSize: 11, fill: 'var(--color-warning)' }} />
              )}
              {drag && drag.a !== drag.b && (
                <ReferenceArea x1={chartDataAll[Math.min(drag.a, drag.b)]?.year ?? undefined} x2={chartDataAll[Math.max(drag.a, drag.b)]?.year ?? undefined}
                  fill="var(--color-accent)" fillOpacity={0.12} stroke="var(--color-accent)" strokeOpacity={0.5} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3" style={{ paddingLeft: 72, paddingRight: 16 }}>
          <RangeScroller
            values={chartDataAll.map(r => Number(r.net) || 0)}
            labels={chartDataAll.map(r => Number(r.year))}
            range={range}
            onChange={r => setZoom(r.start === 0 && r.end === lastIdx ? null : r)}
          />
          <p className="text-[12.5px] faint mt-1">Drag across the chart to zoom in, or drag the bar above to move through the years. Ctrl + scroll zooms, Shift + scroll moves.</p>
        </div>

        <div className="mt-4 pt-4 flex items-center justify-between gap-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="text-[13px] muted">Value at retirement ({retireYear})</p>
          {hidden.size > 0 && <button className="link-btn text-[13px]" onClick={() => setHidden(new Set())}>Show all</button>}
        </div>
        <ul className="mt-2 grid gap-x-6 gap-y-0.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
          {[...series].reverse().sort((a, b) => Number(a.debt) - Number(b.debt)).map(s => {
            const off = hidden.has(s.key);
            const v = lastRow ? valueOf(lastRow, s) : 0;
            return (
              <li key={s.key}>
                <button type="button" aria-pressed={!off} onClick={() => toggle(s.key)}
                  className="w-full flex items-center gap-2.5 py-1.5 px-1.5 -mx-1.5 rounded text-left text-[13.5px] hover:bg-[var(--color-surface-2)]"
                  style={{ opacity: off ? 0.45 : 1 }} title={off ? `Show ${s.name}` : `Hide ${s.name}`}>
                  <span className="swatch" style={{ background: off ? 'transparent' : s.color, boxShadow: off ? `inset 0 0 0 1.5px ${s.color}` : undefined }} />
                  <span className="flex-1 truncate" style={{ color: 'var(--color-text-2)', textDecoration: off ? 'line-through' : undefined }}>{s.name}</span>
                  <span className={`num ${s.debt ? '' : ''}`} style={{ color: 'var(--color-text)' }}>{s.debt ? (v < -0.5 ? `−${money(Math.abs(v), cur, { compact: true })}` : 'Paid off') : money(v, cur, { compact: true })}</span>
                </button>
              </li>
            );
          })}
          <li className="flex items-center gap-2.5 py-1.5 text-[13.5px] muted"><span className="inline-block w-3 h-[2px]" style={{ background: 'var(--color-text)' }} /> Net worth</li>
          {target > 0 && <li className="flex items-center gap-2.5 py-1.5 text-[13.5px] muted"><span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: 'var(--color-text-2)' }} /> Target{targetReal && !real ? ', rising with inflation' : ''}</li>}
          {showRecorded && <li className="flex items-center gap-2.5 py-1.5 text-[13.5px] muted"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-accent)' }} /> Recorded net worth</li>}
        </ul>
      </Panel>

      {/* Life events */}
      <Panel
        title="Life events"
        sub="Big changes the forecast should allow for: a home, children, a career break, paying off a debt."
        actions={<button className="btn btn-sm btn-primary" onClick={openAdd} title="Add a life event (L)"><Icon name="plus" size={15} /> Add life event</button>}
        flush
      >
        {sortedEvents.length === 0 ? (
          <p className="px-5 py-8 text-center muted">No life events yet. Add one to see how it changes the picture.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Year</th><th>Event</th><th>What it does</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {sortedEvents.map(evt => {
                  const goal = evt.type === 'down_payment_target' ? goalById.get(evt.id) : null;
                  const short = warnings.find(w => w.year === evt.year);
                  return (
                    <tr key={evt.id}>
                      <td className="num font-semibold" style={{ color: 'var(--color-text)' }}>{evt.year}</td>
                      <td>
                        <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{evt.label || 'Untitled'}</p>
                        <p className="text-[12.5px] faint">{EVENT_TYPES[evt.type]?.label ?? evt.type}</p>
                      </td>
                      <td className="text-[13px]">
                        {eventSummary(evt, cur, debts)}
                        {evt.notes && <p className="text-[12.5px] faint">{evt.notes}</p>}
                      </td>
                      <td>
                        {goal
                          ? goal.on_track ? <span className="badge badge-good">On track</span> : <span className="badge badge-warn">{money(goal.shortfall, cur, { compact: true })} short</span>
                          : short ? <span className="badge badge-warn">Can’t be fully paid</span>
                          : evt.year < currentYear ? <span className="badge badge-plain">Past</span> : <span className="faint text-[13px]">Included</span>}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <button className="icon-btn" aria-label={`Edit ${evt.label}`} title="Edit" onClick={() => openEdit(evt)}><Icon name="edit" /></button>
                          <button className="icon-btn danger" aria-label={`Delete ${evt.label}`} title="Delete" onClick={() => removeEvent(evt)}><Icon name="trash" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Year by year */}
      <Panel
        title="Year by year"
        sub={`Balances at the end of each year, in ${real ? 'today’s' : 'future'} dollars.`}
        actions={
          <>
            <button className="btn btn-sm btn-ghost" onClick={exportCsv}><Icon name="download" size={15} /> Export CSV</button>
            <Segmented label="Rows" value={everyYear ? 'all' : 'five'} onChange={v => setEveryYear(v === 'all')}
              options={[{ value: 'five', label: 'Every 5 years' }, { value: 'all', label: 'Every year' }]} />
          </>
        }
        flush
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="sticky left-0 z-10" style={{ background: 'var(--color-surface-2)' }}>End of</th>
                <th className="num">Age</th>
                {showRecorded && <th className="num">Recorded</th>}
                {series.map(s => (
                  <th key={s.key} className="num"><span className="inline-flex items-center gap-1.5"><span className="swatch" style={{ background: s.color, width: 8, height: 8 }} />{s.name}</span></th>
                ))}
                <th className="num">Net worth</th>
                {target > 0 && <th className="num">Against target</th>}
                {warnings.length > 0 && <th className="num">Shortfall</th>}
              </tr>
            </thead>
            <tbody>
              {tableRows.map(row => {
                const highlight = row.year === currentYear || row.year === retireYear;
                const bg = highlight ? 'var(--color-accent-bg)' : 'var(--color-surface)';
                const net = scale(row, row.total);
                const tgt = target > 0 ? targetFor(row) : 0;
                return (
                  <tr key={row.year} style={highlight ? { background: 'var(--color-accent-bg)' } : undefined}>
                    <td className="sticky left-0 z-10 num font-semibold" style={{ background: bg, color: 'var(--color-text)' }}>
                      {row.year}{row.year === currentYear && <span className="font-normal text-[12px] muted"> this year</span>}{row.year === retireYear && <span className="font-normal text-[12px] muted"> retire</span>}
                    </td>
                    <td className="num muted">{row.age}</td>
                    {showRecorded && <td className="num">{historyMap.has(row.year) ? money(historyMap.get(row.year)!, cur) : <span className="faint">–</span>}</td>}
                    {series.map(s => {
                      const v = valueOf(row, s);
                      return <td key={s.key} className={`num ${s.debt && v < -0.5 ? 'text-negative' : 'muted'}`}>{Math.abs(v) < 0.5 ? '–' : `${v < 0 ? '−' : ''}${money(Math.abs(v), cur, { compact: true })}`}</td>;
                    })}
                    <td className="num font-semibold" style={{ color: 'var(--color-text)' }}>{money(net, cur)}</td>
                    {target > 0 && <td className={`num ${net >= tgt ? 'text-positive' : 'faint'}`}>{net >= tgt ? '+' : '−'}{money(Math.abs(net - tgt), cur, { compact: true })}</td>}
                    {warnings.length > 0 && <td className={`num ${row.shortfall > 0 ? 'text-warning' : 'faint'}`}>{row.shortfall > 0 ? money(scale(row, row.shortfall), cur, { compact: true }) : '–'}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Life event form */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingEvent ? 'Edit life event' : 'Add a life event'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn btn-secondary">Cancel</button>
            <button type="submit" form="event-form" disabled={saving || !form.label.trim() || (form.type === 'debt_payoff' && !form.debt_id)} className="btn btn-primary">
              {saving ? 'Saving…' : editingEvent ? 'Save changes' : 'Add life event'}
            </button>
          </div>
        }
      >
        <form id="event-form" onSubmit={e => { e.preventDefault(); handleSave(); }} className="space-y-5">
          <fieldset>
            <legend className="form-label">What’s happening?</legend>
            <div className="space-y-2">
              {['Home', 'Family', 'Work', 'Money'].map(group => (
                <div key={group} className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] faint w-14">{group}</span>
                  {Object.entries(EVENT_TYPES).filter(([, t]) => t.group === group).map(([key, t]) => (
                    <button key={key} type="button" className="chip" aria-pressed={form.type === key} onClick={() => set('type', key)}>{t.label}</button>
                  ))}
                </div>
              ))}
            </div>
            <p className="form-hint">{EVENT_TYPES[form.type]?.hint}</p>
          </fieldset>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="form-label" htmlFor="ev-label">Name</label>
              <input id="ev-label" className="form-input" value={form.label} onChange={e => set('label', e.target.value)}
                placeholder={({ property_purchase: 'First home', down_payment_target: 'House deposit', expense: 'Wedding', windfall: 'Inheritance', income_change: 'Promotion', savings_change: 'Save more', child: 'First child', education: 'College', career_break: 'Sabbatical', semi_retirement: 'Part-time work', debt_payoff: 'Clear student loan' } as Record<string, string>)[form.type]} />
            </div>
            <div>
              <label className="form-label" htmlFor="ev-year">{form.type === 'semi_retirement' ? 'From year' : 'Year'}</label>
              <input id="ev-year" type="number" className="form-input" value={form.year} min={currentYear} max={2100} onChange={e => set('year', Number(e.target.value))} />
              <p className="form-hint">Age {ageFor(Number(form.year) || currentYear)}</p>
            </div>
          </div>

          {form.type === 'property_purchase' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <MoneyField id="ev-pv" label="Home price" sym={sym} value={form.property_value} onChange={v => set('property_value', v)} />
                <MoneyField id="ev-dp" label="Down payment" sym={sym} value={form.down_payment} onChange={v => set('down_payment', v)} />
              </div>
              <div>
                <label className="form-label" htmlFor="ev-from">Pay the down payment from</label>
                <select id="ev-from" className="form-input" value={form.funded_from} onChange={e => set('funded_from', e.target.value)}>
                  {Object.entries(BUCKET_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="form-label" htmlFor="ev-mr">Mortgage rate</label>
                  <div className="affix"><input id="ev-mr" type="number" step="0.05" min="0" value={form.mortgage_rate} onChange={e => set('mortgage_rate', e.target.value)} /><span>%</span></div>
                </div>
                <div>
                  <label className="form-label" htmlFor="ev-my">Term</label>
                  <div className="affix"><input id="ev-my" type="number" min="1" max="40" value={form.mortgage_years} onChange={e => set('mortgage_years', e.target.value)} /><span>years</span></div>
                </div>
                <MoneyField id="ev-mm" label="Monthly payment" sym={sym} value={form.mortgage_monthly} onChange={v => set('mortgage_monthly', v)} placeholder={suggestedMortgage > 0 ? Math.round(suggestedMortgage).toString() : '0'} />
              </div>
              <p className="form-hint" style={{ marginTop: -8 }}>
                {suggestedMortgage > 0 ? `Leave the payment blank to use ${money(suggestedMortgage, cur)} a month, the standard payment for this loan. ` : ''}
                Enter a higher payment if you plan to pay it off early.
              </p>
              <MoneyField id="ev-rent" label="Rent you’ll stop paying, per month" sym={sym} value={form.rent_monthly} onChange={v => set('rent_monthly', v)} />
              {price > 0 && (
                <p className="callout">
                  The home is added at {money(price, cur)} and grows with the property rate in Settings. A {money(Math.max(0, price - dp), cur)} mortgage is paid down from your savings
                  {Number(form.rent_monthly) > 0 ? `, offset by the ${money(Number(form.rent_monthly) * 12, cur)} a year you no longer spend on rent` : ''}.
                </p>
              )}
            </>
          )}

          {form.type === 'down_payment_target' && (() => {
            const defaults = accounts.filter(acc => GOAL_DEFAULT_TYPES.includes(acc.account_type)).map(acc => acc.id);
            const chosen = form.account_ids ?? defaults;
            const toggleAcc = (id: string) => set('account_ids', chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id]);
            return (
              <>
                <MoneyField id="ev-target" label="Amount you want available, in today’s money" sym={sym} value={form.target_amount} onChange={v => set('target_amount', v)} />
                <fieldset>
                  <legend className="form-label">Accounts that count toward it</legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                    {[...accounts].sort((x, y) => typeRank(x.account_type) - typeRank(y.account_type)).map(acc => (
                      <label key={acc.id} className="flex items-center gap-2 text-[13.5px] cursor-pointer">
                        <input type="checkbox" checked={chosen.includes(acc.id)} onChange={() => toggleAcc(acc.id)} />
                        <span style={{ color: 'var(--color-text-2)' }}>{acc.name}</span>
                        <span className="faint text-[12.5px]">{typeLabel(acc.account_type)}</span>
                      </label>
                    ))}
                  </div>
                  <p className="form-hint">
                    {form.account_ids === null
                      ? 'Your savings, checking and brokerage accounts are ticked by default. Untick long-term investments you wouldn’t sell for this.'
                      : 'Only the ticked accounts are counted.'}
                  </p>
                </fieldset>
                <p className="form-hint" style={{ marginTop: -4 }}>Measured at the start of {form.year}, so the money is there before anything you buy that year.</p>
              </>
            );
          })()}

          {(form.type === 'child' || form.type === 'education') && (
            <div className="grid grid-cols-2 gap-3">
              <MoneyField id="ev-cost" label={form.type === 'child' ? 'Cost per year' : 'Fees per year'} sym={sym} value={form.annual_cost} onChange={v => set('annual_cost', v)} placeholder={form.type === 'child' ? '15000' : '30000'} />
              <div>
                <label className="form-label" htmlFor="ev-dur">For</label>
                <div className="affix"><input id="ev-dur" type="number" min="1" max="30" value={form.duration_years} onChange={e => set('duration_years', e.target.value)} placeholder={form.type === 'child' ? '18' : '4'} /><span>years</span></div>
              </div>
              {form.type === 'education' && (
                <div className="col-span-2">
                  <label className="form-label" htmlFor="ev-edfrom">Pay from</label>
                  <select id="ev-edfrom" className="form-input" value={form.funded_from === 'savings' ? '529' : form.funded_from} onChange={e => set('funded_from', e.target.value)}>
                    {Object.entries(BUCKET_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <p className="form-hint">If that account runs out, the rest comes from savings and brokerage.</p>
                </div>
              )}
            </div>
          )}

          {(form.type === 'expense' || form.type === 'windfall') && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2"><MoneyField id="ev-amt" label="Amount" sym={currencySymbol(form.currency)} value={form.amount} onChange={v => set('amount', v)} /></div>
                <div>
                  <label className="form-label" htmlFor="ev-cur">Currency</label>
                  <select id="ev-cur" className="form-input" value={form.currency} onChange={e => set('currency', e.target.value)}>
                    {['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'CHF', 'JPY'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="form-label" htmlFor="ev-acc">{form.type === 'expense' ? 'Pay from' : 'Invest into'}</label>
                {form.type === 'expense' ? (
                  <select id="ev-acc" className="form-input" value={form.funded_from} onChange={e => set('funded_from', e.target.value)}>
                    {Object.entries(BUCKET_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                ) : (
                  <select id="ev-acc" className="form-input" value={form.into_type} onChange={e => set('into_type', e.target.value)}>
                    {Object.entries(BUCKET_LABELS).filter(([k]) => k !== 'savings').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                )}
              </div>
            </>
          )}

          {['income_change', 'savings_change', 'career_break', 'semi_retirement'].includes(form.type) && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <MoneyField id="ev-save" label={form.type === 'career_break' ? 'What you’d save per year during the break' : 'What you’d save per year'} sym={sym}
                  value={form.new_annual_savings} onChange={v => set('new_annual_savings', v)} placeholder={form.type === 'career_break' || form.type === 'semi_retirement' ? '0' : String(Math.round(savingsNow))} />
                <p className="form-hint">Your own contributions today are {money(savingsNow, cur)} a year. Employer contributions carry on unless you change them on the account.</p>
              </div>
              {form.type !== 'semi_retirement' && (
                <div>
                  <label className="form-label" htmlFor="ev-dur2">For</label>
                  <div className="affix"><input id="ev-dur2" type="number" min="1" max="50" value={form.duration_years} onChange={e => set('duration_years', e.target.value)} placeholder={form.type === 'career_break' ? '1' : 'Until retirement'} /><span>years</span></div>
                  <p className="form-hint">{form.type === 'career_break' ? 'Saving goes back to normal afterwards.' : 'Leave blank to keep this until retirement.'}</p>
                </div>
              )}
            </div>
          )}

          {form.type === 'debt_payoff' && (
            debts.length === 0 ? (
              <p className="callout callout-warn">You haven’t added any debts yet. <button type="button" className="link-btn" onClick={() => navigate('/accounts')}>Add one on the Accounts page</button>.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="form-label" htmlFor="ev-debt">Which debt</label>
                  <select id="ev-debt" className="form-input" value={form.debt_id} onChange={e => set('debt_id', e.target.value)}>
                    <option value="">Choose a debt</option>
                    {debts.map(d => <option key={d.id} value={d.id}>{d.name} ({DEBT_LABELS[d.debt_type] ?? 'Debt'}, {money(d.balance, d.currency)} owed)</option>)}
                  </select>
                </div>
                <MoneyField id="ev-payamt" label="Amount (blank to clear it)" sym={sym} value={form.amount} onChange={v => set('amount', v)} />
                <div>
                  <label className="form-label" htmlFor="ev-payfrom">Pay from</label>
                  <select id="ev-payfrom" className="form-input" value={form.funded_from} onChange={e => set('funded_from', e.target.value)}>
                    {Object.entries(BUCKET_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
              </div>
            )
          )}

          <div>
            <label className="form-label" htmlFor="ev-notes">Notes (optional)</label>
            <textarea id="ev-notes" rows={2} className="form-input" style={{ resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
          <p className="form-hint">Enter costs and prices in today’s money; the forecast raises them with inflation to the year they happen. Savings amounts and mortgage payments are used as entered.</p>
        </form>
      </Modal>
    </div>
  );
}

function MoneyField({ id, label, sym, value, onChange, placeholder = '0' }: {
  id: string; label: string; sym: string; value: string | number; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="form-label" htmlFor={id}>{label}</label>
      <div className="affix"><span>{sym}</span><input id={id} type="number" step="any" min="0" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></div>
    </div>
  );
}
