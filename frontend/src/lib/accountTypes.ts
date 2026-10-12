import { convert } from './format';

export const TYPE_LABELS: Record<string, string> = {
  '401k':          '401(k)',
  '403b':          '403(b)',
  '457b':          '457(b)',
  traditional_ira: 'Traditional IRA',
  roth_ira:        'Roth IRA',
  hsa:             'HSA',
  '529':           '529 plan',
  pension:         'Pension / SIPP',
  isa:             'ISA',
  brokerage:       'Brokerage',
  cash:            'Savings',
  checking:        'Checking',
  alternative:     'Alternative',
  crypto:          'Crypto',
  company_stock:   'Company stock',
  property:        'Property',
  other:           'Other',
};

/** Grouping used in the type picker. */
export const TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: 'Workplace retirement', types: ['401k', '403b', '457b', 'pension'] },
  { label: 'IRAs and tax-advantaged', types: ['traditional_ira', 'roth_ira', 'hsa', '529', 'isa'] },
  { label: 'Everyday and investing', types: ['cash', 'checking', 'brokerage'] },
  { label: 'Other holdings', types: ['company_stock', 'crypto', 'alternative', 'property', 'other'] },
];

/** Stacking and listing order: retirement wrappers first, then liquid, then speculative. */
export const TYPE_ORDER = [
  '401k', '403b', '457b', 'traditional_ira', 'roth_ira', 'pension', 'hsa', '529', 'isa',
  'brokerage', 'cash', 'checking', 'alternative', 'crypto', 'company_stock', 'property', 'other',
];

/**
 * Types that behave alike share a hue family; accounts inside a family are told apart by
 * lightness. The family order 401(k) → pension → brokerage → alternative → crypto → company stock
 * was checked for colour-blind separation as adjacent pairs.
 */
const FAMILY: Record<string, string> = {
  '401k': 'workplace', '403b': 'workplace', '457b': 'workplace',
  traditional_ira: 'ira', roth_ira: 'ira',
  pension: 'pension', hsa: 'advantaged', isa: 'advantaged', '529': 'alternative',
  brokerage: 'brokerage', cash: 'cash', checking: 'cash',
  alternative: 'alternative', crypto: 'crypto', company_stock: 'company_stock',
  property: 'property', other: 'other',
};

const FAMILY_COLORS: Record<string, string> = {
  workplace:     '#2a78d6',
  ira:           '#e87ba4',
  pension:       '#eb6834',
  advantaged:    '#008300',
  brokerage:     '#1baf7a',
  cash:          '#8c96a3',
  alternative:   '#eda100',
  crypto:        '#4a3aa7',
  company_stock: '#e34948',
  property:      '#a3784f',
  other:         '#9aa3ad',
  debt:          '#475569',
};

export const TYPE_DEFAULT_RETURNS: Record<string, number> = {
  brokerage: 8.0, isa: 8.0, '401k': 7.0, '403b': 7.0, '457b': 7.0, traditional_ira: 7.0, roth_ira: 7.0,
  hsa: 7.0, '529': 6.0, pension: 6.5, crypto: 15.0, property: 3.5, cash: 4.0, checking: 0,
  company_stock: 9.0, alternative: 7.5, other: 7.0,
};

export const typeLabel = (t: string) => TYPE_LABELS[t] ?? DEBT_LABELS[t] ?? t.replace(/_/g, ' ');
export const familyOf = (t: string) => FAMILY[t] ?? (DEBT_LABELS[t] ? 'debt' : 'other');
export const typeColor = (t: string) => FAMILY_COLORS[familyOf(t)];
export const typeRank = (t: string) => {
  const i = TYPE_ORDER.indexOf(t);
  return i === -1 ? TYPE_ORDER.length : i;
};

function mix(hex: string, target: string, amount: number) {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(target.slice(1), 16);
  const ch = (n: number, shift: number) => (n >> shift) & 255;
  const out = [16, 8, 0].map(s => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * amount));
  return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Lightness steps alternate darker and lighter so neighbours in a stack never sit one step apart. */
export function shade(base: string, index: number) {
  const steps = [0, -0.3, 0.38, -0.5, 0.58, -0.15, 0.2];
  const s = steps[index % steps.length];
  return s === 0 ? base : s < 0 ? mix(base, '#000000', -s) : mix(base, '#ffffff', s);
}
export const shadeFor = (type: string, index: number) => shade(typeColor(type), index);

/* ─── Contributions ─────────────────────────────────────────────────────── */

export const FREQ_OPTIONS = [
  { value: '',            label: 'No regular contributions', mult: 0  },
  { value: 'weekly',      label: 'Weekly',                   mult: 52 },
  { value: 'biweekly',    label: 'Every two weeks',          mult: 26 },
  { value: 'semimonthly', label: 'Twice a month',            mult: 24 },
  { value: 'monthly',     label: 'Monthly',                  mult: 12 },
  { value: 'annual',      label: 'Once a year',              mult: 1  },
];

export const MATCH_TYPES = ['401k', '403b', '457b', 'hsa', 'pension'];
export const WORKPLACE_PLANS = ['401k', '403b', '457b'];

/** Your own yearly contribution, in the account's currency. */
export function employeeContribution(acc: any) {
  const opt = FREQ_OPTIONS.find(f => f.value === (acc.contribution_frequency ?? ''));
  const regular = acc.contribution_amount && opt ? acc.contribution_amount * opt.mult : (acc.monthly_contribution ?? 0) * 12;
  return regular + (acc.annual_lump_sum ?? 0);
}

/** Yearly employer match, in the account's currency. `salary` must already be in that currency. */
export function employerMatch(acc: any, salary: number) {
  const pct = (acc.employer_match_pct ?? 0) / 100;
  switch (acc.employer_match_mode) {
    case 'fixed':
      return (acc.employer_match_amount ?? 0) * (acc.employer_match_frequency === 'monthly' ? 12 : 1);
    case 'pct_salary':
      return salary * pct;
    case 'pct_contrib': {
      const regular = employeeContribution(acc) - (acc.annual_lump_sum ?? 0);
      const cap = (acc.employer_match_cap_pct ?? 0) / 100;
      return (cap > 0 && salary > 0 ? Math.min(regular, salary * cap) : regular) * pct;
    }
    default:
      return 0;
  }
}

/* ─── Tax treatment ─────────────────────────────────────────────────────── */

export type TaxBucket = 'pre_tax' | 'roth' | 'tax_free' | 'taxable' | 'cash' | 'property';

export function taxBucket(type: string, override?: string | null): TaxBucket {
  if (WORKPLACE_PLANS.includes(type) && override === 'roth') return 'roth';
  if (['401k', '403b', '457b', 'traditional_ira', 'pension'].includes(type)) return 'pre_tax';
  if (type === 'roth_ira') return 'roth';
  if (['isa', 'hsa', '529'].includes(type)) return 'tax_free';
  if (type === 'cash' || type === 'checking') return 'cash';
  if (type === 'property') return 'property';
  return 'taxable';
}

export const TAX_LABELS: Record<TaxBucket, string> = {
  pre_tax: 'Pre-tax', roth: 'Roth', tax_free: 'Tax-advantaged', taxable: 'Taxable', cash: 'Taxable interest', property: 'Property',
};

export function taxNote(type: string, override?: string | null): string {
  if (type === 'pension') return 'UK pension. You get tax relief on contributions. Usually a quarter can be taken tax-free from 57; the rest is taxed as income.';
  if (type === 'hsa') return 'Contributions are pre-tax, growth is tax-free, and withdrawals for medical costs are tax-free. After 65 you can take money out for anything, taxed like a traditional IRA.';
  if (type === '529') return 'Growth and withdrawals are tax-free when spent on qualified education. Other withdrawals are taxed and usually carry a 10% penalty on the gains.';
  if (type === 'isa') return 'UK ISA. No tax on interest, dividends or gains, and withdrawals are tax-free.';
  if (type === 'property') return 'Gains on your main home are largely exempt from tax when you sell (up to $250,000, or $500,000 for couples, in the US).';
  switch (taxBucket(type, override)) {
    case 'pre_tax': return 'Contributions lower your taxable income now. Withdrawals in retirement are taxed as income, taking money out before 59½ usually costs a 10% penalty, and from 73 you must take a minimum amount each year.';
    case 'roth':    return 'Paid in from after-tax income. Withdrawals after 59½, once the account is five years old, are tax-free and there’s no required minimum.';
    case 'cash':    return 'Interest is taxed as income each year.';
    default:        return 'Dividends and interest are taxed each year, and you pay capital gains tax when you sell at a profit. Holding for over a year gets the lower long-term rate.';
  }
}

/* ─── Contribution limits ───────────────────────────────────────────────── */

export const LIMIT_YEAR = 2026;

interface LimitGroup {
  id: string;
  label: string;
  types: string[];
  currency: string;
  limit: (age: number, acc?: any) => number;
  includesMatch?: boolean;
}

/** IRS limits for 2026 (and the UK ISA allowance). Employee contributions only, unless noted. */
export const LIMIT_GROUPS: LimitGroup[] = [
  {
    id: 'elective', label: '401(k) and 403(b) contributions', types: ['401k', '403b'], currency: 'USD',
    limit: age => 24_500 + (age >= 60 && age <= 63 ? 11_250 : age >= 50 ? 8_000 : 0),
  },
  {
    id: '457b', label: '457(b) contributions', types: ['457b'], currency: 'USD',
    limit: age => 24_500 + (age >= 50 ? 8_000 : 0),
  },
  {
    id: 'total_dc', label: 'Total 401(k) and 403(b) contributions including your employer', types: ['401k', '403b'], currency: 'USD',
    limit: age => 72_000 + (age >= 60 && age <= 63 ? 11_250 : age >= 50 ? 8_000 : 0), includesMatch: true,
  },
  {
    id: 'ira', label: 'IRA contributions (traditional and Roth combined)', types: ['traditional_ira', 'roth_ira'], currency: 'USD',
    limit: age => 7_500 + (age >= 50 ? 1_100 : 0),
  },
  {
    id: 'hsa', label: 'HSA contributions including your employer', types: ['hsa'], currency: 'USD',
    limit: (age, acc) => (acc?.hsa_coverage === 'family' ? 8_750 : 4_400) + (age >= 55 ? 1_000 : 0), includesMatch: true,
  },
  {
    id: 'isa', label: 'ISA allowance', types: ['isa'], currency: 'GBP',
    limit: () => 20_000,
  },
];

export interface LimitCheck { id: string; label: string; total: number; limit: number; currency: string; accounts: string[] }

/**
 * Yearly contributions per limit group, flagged when over. `accounts` should already include any
 * unsaved edits. Salary is in display currency.
 */
export function checkLimits(accounts: any[], birthYear: number | null | undefined, rates: Record<string, number> | undefined, salary = 0, displayCurrency = 'USD'): LimitCheck[] {
  const age = birthYear ? LIMIT_YEAR - birthYear : 0;
  const out: LimitCheck[] = [];
  for (const g of LIMIT_GROUPS) {
    const members = accounts.filter(a => g.types.includes(a.account_type));
    if (members.length === 0) continue;
    let total = 0;
    for (const a of members) {
      const cur = a.currency ?? 'USD';
      const sal = convert(salary, displayCurrency, cur, rates);
      const amount = employeeContribution(a) + (g.includesMatch ? employerMatch(a, sal) : 0);
      total += convert(amount, cur, g.currency, rates);
    }
    const limit = g.limit(age, members[0]);
    if (total > limit + 0.5) out.push({ id: g.id, label: g.label, total, limit, currency: g.currency, accounts: members.map(m => m.name) });
  }
  return out;
}

/* ─── Debts ─────────────────────────────────────────────────────────────── */

export const DEBT_LABELS: Record<string, string> = {
  mortgage: 'Mortgage', student_loan: 'Student loan', auto: 'Car loan',
  credit_card: 'Credit card', personal: 'Personal loan', other: 'Other debt',
};

/** Above this yearly rate a growth assumption is flagged as unusually optimistic. */
export const HIGH_GROWTH_PCT = 15;

export const CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD', 'CHF', 'JPY'];
