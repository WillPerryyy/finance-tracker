export function money(value: number, currency = 'USD', opts: { compact?: boolean; cents?: boolean } = {}) {
  const { compact = false, cents = false } = opts;
  const useCompact = compact && Math.abs(value) >= 10_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: useCompact ? 'compact' : 'standard',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : useCompact ? 1 : 0,
  }).format(value);
}

export function currencySymbol(currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 })
    .formatToParts(0)
    .find(p => p.type === 'currency')?.value ?? currency;
}

export function percent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

export function daysSince(isoDate?: string | null): number | null {
  if (!isoDate) return null;
  const then = new Date(isoDate + (isoDate.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(then.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((now.getTime() - then.getTime()) / 86_400_000));
}

export function relativeDate(isoDate?: string | null): string {
  const d = daysSince(isoDate);
  if (d === null) return 'Never';
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  const months = Math.round(d / 30.4);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

export function longDate(isoDate?: string | null): string {
  if (!isoDate) return '';
  const d = new Date(isoDate + (isoDate.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** An account balance older than this many days is flagged for updating. */
export const STALE_AFTER_DAYS = 60;

export function convert(value: number, from: string, to: string, rates: Record<string, number> | undefined) {
  if (from === to || !rates) return value;
  const usd = from === 'USD' ? value : value / (rates[from] ?? 1);
  return to === 'USD' ? usd : usd * (rates[to] ?? 1);
}
