/** Months until a debt is cleared at a fixed monthly payment, or null if the payment never covers the interest. */
export function monthsToPayoff(balance: number, ratePct: number, payment: number): number | null {
  if (balance <= 0) return 0;
  if (payment <= 0) return null;
  const r = ratePct / 100 / 12;
  if (r === 0) return Math.ceil(balance / payment);
  if (payment <= balance * r) return null;
  return Math.ceil(-Math.log(1 - (balance * r) / payment) / Math.log(1 + r));
}

export function totalInterest(balance: number, ratePct: number, payment: number): number | null {
  const n = monthsToPayoff(balance, ratePct, payment);
  if (n === null) return null;
  return Math.max(0, n * payment - balance);
}

export function payoffLabel(months: number | null): string {
  if (months === null) return 'Never at this payment';
  if (months === 0) return 'Paid off';
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
