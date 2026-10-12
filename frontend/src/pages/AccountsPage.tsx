import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getAccounts, deleteAccount, getExchangeRates, getSettings, getDebts, deleteDebt } from '../api/client';
import { PageHeader, Panel, EmptyState, Loading, Icon } from '../components/ui';
import { useToast, useShortcut } from '../components/chrome';
import { AccountFormDialog, type PlanContext } from '../components/accounts/AccountForm';
import { DebtFormDialog } from '../components/accounts/DebtForm';
import { UpdateBalanceDialog, HistoryDialog } from '../components/accounts/BalanceDialogs';
import { ImportDialog } from '../components/accounts/ImportDialog';
import {
  TYPE_DEFAULT_RETURNS, DEBT_LABELS, HIGH_GROWTH_PCT, LIMIT_YEAR,
  typeLabel, typeColor, typeRank, employeeContribution, employerMatch, taxBucket, TAX_LABELS, checkLimits,
} from '../lib/accountTypes';
import { money, relativeDate, daysSince, longDate, convert, STALE_AFTER_DAYS } from '../lib/format';
import { monthsToPayoff, payoffLabel } from '../lib/debt';
import { downloadCsv } from '../lib/csv';

export default function AccountsPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [debts, setDebts] = useState<any[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [rates, setRates] = useState<Record<string, number> | undefined>();
  const [settings, setSettings] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  const [accountForm, setAccountForm] = useState<{ open: boolean; account: any | null }>({ open: false, account: null });
  const [debtForm, setDebtForm] = useState<{ open: boolean; debt: any | null }>({ open: false, debt: null });
  const [updating, setUpdating] = useState<{ item: any; kind: 'account' | 'debt' } | null>(null);
  const [history, setHistory] = useState<{ id: string; kind: 'account' | 'debt' } | null>(null);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    try {
      const [a, d] = await Promise.all([getAccounts(), getDebts().catch(() => [])]);
      setAccounts(a); setDebts(d);
    } catch { /* keep the current lists on a network hiccup */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    load();
    getExchangeRates().then(r => setRates(r?.rates)).catch(() => {});
    getSettings().then(s => setSettings(s ?? {})).catch(() => {});
  }, []);

  useEffect(() => {
    if (params.get('start') === '1' && !loading) {
      setAccountForm({ open: true, account: null });
      setParams({}, { replace: true });
    }
  }, [params, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayCurrency = settings.display_currency ?? 'USD';
  const salary = Number(settings.salary) || 0;
  const typeReturns = useMemo(() => ({
    ...TYPE_DEFAULT_RETURNS,
    ...Object.fromEntries(Object.entries(settings.risk_profiles ?? {}).map(([t, v]: [string, any]) => [t, (v?.expected_return ?? 0) * 100])),
  }), [settings]);

  const rows = useMemo(() => accounts
    .filter(a => !hidden.has(a.id))
    .map(a => {
      const cur = a.currency ?? 'USD';
      return {
        ...a,
        converted: convert(a.value ?? 0, cur, displayCurrency, rates),
        yours: employeeContribution(a),
        match: employerMatch(a, convert(salary, displayCurrency, cur, rates)),
      };
    })
    .sort((a, b) => typeRank(a.account_type) - typeRank(b.account_type) || b.converted - a.converted),
  [accounts, hidden, rates, displayCurrency, salary]);

  const debtRows = useMemo(() => debts
    .filter(d => !hidden.has(d.id))
    .map(d => ({ ...d, converted: convert(d.balance ?? 0, d.currency ?? 'USD', displayCurrency, rates) }))
    .sort((a, b) => b.converted - a.converted),
  [debts, hidden, rates, displayCurrency]);

  const totalAssets = rows.reduce((s, a) => s + a.converted, 0);
  const totalDebts = debtRows.reduce((s, d) => s + d.converted, 0);
  const multiCurrency = [...rows, ...debtRows].some(x => (x.currency ?? 'USD') !== displayCurrency);
  const staleCount = rows.filter(a => (daysSince(a.last_updated) ?? Infinity) > STALE_AFTER_DAYS).length;
  const overLimits = checkLimits(rows, settings.birth_year, rates, salary, displayCurrency);
  const ctx: PlanContext = { typeReturns, birthYear: settings.birth_year ?? null, salary, displayCurrency, rates, accounts };

  /* ── Delete with undo ── */
  const unhide = (id: string) => setHidden(h => { const n = new Set(h); n.delete(id); return n; });
  const remove = (item: any, kind: 'account' | 'debt') => {
    setHidden(h => new Set(h).add(item.id));
    toast.undoable({
      message: `Deleted ${item.name}`,
      commit: async () => { await (kind === 'account' ? deleteAccount(item.id) : deleteDebt(item.id)); await load(); unhide(item.id); },
      onUndo: () => unhide(item.id),
    });
  };

  /* ── Keyboard ── */
  const order = [
    ...rows.map(r => ({ id: r.id, kind: 'account' as const, item: r })),
    ...debtRows.map(d => ({ id: d.id, kind: 'debt' as const, item: d })),
  ];
  const current = order.find(o => o.id === selected) ?? null;
  const move = (delta: number) => {
    if (order.length === 0) return;
    const i = current ? order.indexOf(current) : -1;
    const next = order[Math.min(order.length - 1, Math.max(0, i + delta))];
    setSelected(next.id);
    rowRefs.current.get(next.id)?.focus();
  };
  const edit = (o: { kind: 'account' | 'debt'; item: any }) =>
    o.kind === 'account' ? setAccountForm({ open: true, account: o.item }) : setDebtForm({ open: true, debt: o.item });
  useShortcut(['ArrowDown', 'j'], () => move(1));
  useShortcut(['ArrowUp', 'k'], () => move(-1));
  useShortcut('n', () => setAccountForm({ open: true, account: null }));
  useShortcut('d', () => setDebtForm({ open: true, debt: null }));
  useShortcut('i', () => setImporting(true));
  useShortcut('u', () => current && setUpdating({ item: current.item, kind: current.kind }));
  useShortcut('h', () => current && setHistory({ id: current.id, kind: current.kind }));
  useShortcut('e', () => current && edit(current));
  useShortcut(['Delete', 'Backspace'], () => { if (current) { remove(current.item, current.kind); move(1); } });

  const exportCsv = () => downloadCsv(`accounts-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Name', 'Type', 'Provider', 'Currency', 'Balance', `Balance (${displayCurrency})`, 'Your contributions per year', 'Employer per year', 'Last updated'],
    ...rows.map(a => [a.name, typeLabel(a.account_type), a.institution ?? '', a.currency, a.value ?? 0, Math.round(a.converted), Math.round(a.yours), Math.round(a.match), a.last_updated ?? '']),
    ...debtRows.map(d => [d.name, DEBT_LABELS[d.debt_type] ?? 'Debt', d.lender ?? '', d.currency, -(d.balance ?? 0), -Math.round(d.converted), '', '', d.last_updated ?? '']),
  ]);

  if (loading) return <Loading />;

  const rowProps = (id: string) => ({
    ref: (el: HTMLTableRowElement | null) => { if (el) rowRefs.current.set(id, el); else rowRefs.current.delete(id); },
    tabIndex: 0,
    'aria-selected': selected === id,
    onFocus: () => setSelected(id),
    onClick: () => setSelected(id),
    style: selected === id ? { boxShadow: 'inset 3px 0 0 var(--color-accent)', outline: 'none' } : { outline: 'none' },
  });
  const historyItem = history ? (history.kind === 'account' ? accounts : debts).find(x => x.id === history.id) ?? null : null;

  return (
    <div>
      <PageHeader
        title="Accounts"
        sub="Keep these balances current. Every forecast starts from the numbers here."
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setImporting(true)} title="Import (I)">Import CSV</button>
            {(rows.length > 0 || debtRows.length > 0) && <button className="btn btn-ghost" onClick={exportCsv}>Export CSV</button>}
            <button className="btn btn-secondary" onClick={() => setDebtForm({ open: true, debt: null })} title="Add a debt (D)"><Icon name="plus" size={16} /> Add debt</button>
            <button className="btn btn-primary" onClick={() => setAccountForm({ open: true, account: null })} title="Add an account (N)"><Icon name="plus" size={16} /> Add account</button>
          </>
        }
      />

      {rows.length === 0 && debtRows.length === 0 ? (
        <EmptyState title="No accounts yet" body="Add each retirement account, investment account and savings pot you want to track. You only need a name, a type and today’s balance to start. You can also import a CSV export from your bank or broker.">
          <button className="btn btn-primary" onClick={() => setAccountForm({ open: true, account: null })}>Add your first account</button>
          <button className="btn btn-secondary" onClick={() => setImporting(true)}>Import CSV</button>
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {(staleCount > 0 || overLimits.length > 0) && (
            <div className="space-y-2">
              {overLimits.map(l => (
                <div key={l.id} className="callout callout-warn flex items-start gap-2">
                  <span className="mt-0.5"><Icon name="alert" size={16} /></span>
                  <p>{l.label} add up to <strong>{money(l.total, l.currency)}</strong> a year, above the {LIMIT_YEAR} limit of {money(l.limit, l.currency)} ({l.accounts.join(', ')}).</p>
                </div>
              ))}
              {staleCount > 0 && (
                <div className="callout callout-warn flex items-center gap-2">
                  <Icon name="alert" size={16} />
                  {staleCount === 1 ? '1 balance hasn’t' : `${staleCount} balances haven’t`} been updated in over {STALE_AFTER_DAYS} days. Their Update buttons are shown in blue.
                </div>
              )}
            </div>
          )}

          <Panel title="Accounts" sub="Click a row, then use the arrow keys and U, E, H or Delete. Press ? for all shortcuts." flush>
            {rows.length === 0 ? (
              <p className="px-5 py-6 muted text-[14px]">No accounts yet. <button className="link-btn" onClick={() => setAccountForm({ open: true, account: null })}>Add one</button>.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Type</th>
                      <th className="num">Balance</th>
                      {multiCurrency && <th className="num">In {displayCurrency}</th>}
                      <th className="num">Added per year</th>
                      <th className="num">Growth</th>
                      <th>Updated</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(acc => {
                      const age = daysSince(acc.last_updated);
                      const stale = age === null || age > STALE_AFTER_DAYS;
                      const custom = acc.expected_return != null;
                      const growth = custom ? acc.expected_return * 100 : (typeReturns[acc.account_type] ?? 7);
                      const last = acc.value_history?.length ? acc.value_history[acc.value_history.length - 1] : null;
                      const delta = last ? (acc.value ?? 0) - last.value : 0;
                      return (
                        <tr key={acc.id} {...rowProps(acc.id)}>
                          <td>
                            <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{acc.name}</p>
                            <p className="text-[12.5px] faint">
                              {[acc.institution, acc.account_number ? `ending ${String(acc.account_number).slice(-4)}` : null].filter(Boolean).join(', ') || 'No provider set'}
                            </p>
                          </td>
                          <td>
                            <span className="inline-flex items-center gap-2 whitespace-nowrap">
                              <span className="swatch" style={{ background: typeColor(acc.account_type) }} />
                              {typeLabel(acc.account_type)}
                            </span>
                            <p className="text-[12px] faint" style={{ marginLeft: 18 }}>{TAX_LABELS[taxBucket(acc.account_type, acc.tax_treatment)]}</p>
                          </td>
                          <td className="num">
                            <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{money(acc.value ?? 0, acc.currency)}</p>
                            {Math.abs(delta) >= 1 && (
                              <p className={`text-[12px] ${delta > 0 ? 'text-positive' : 'text-negative'}`}>
                                {delta > 0 ? '+' : '−'}{money(Math.abs(delta), acc.currency)} since {longDate(last.date)}
                              </p>
                            )}
                          </td>
                          {multiCurrency && <td className="num muted">{money(acc.converted, displayCurrency)}</td>}
                          <td className="num">
                            {acc.yours + acc.match > 0 ? (
                              <>
                                <p>{money(acc.yours + acc.match, acc.currency)}</p>
                                {acc.match > 0 && <p className="text-[12px] faint">incl. {money(acc.match, acc.currency)} employer</p>}
                              </>
                            ) : <span className="faint">None</span>}
                          </td>
                          <td className="num">
                            {growth > HIGH_GROWTH_PCT ? (
                              <span className="badge badge-warn" title="Unusually high. This account will dominate the forecast."><Icon name="alert" size={13} /> {growth.toFixed(1)}%</span>
                            ) : (
                              <>{growth.toFixed(1)}%<span className="faint text-[12px]">{custom ? ' custom' : ''}</span></>
                            )}
                          </td>
                          <td>
                            <span className={stale ? 'badge badge-warn' : 'muted text-[13px]'} title={acc.last_updated ? longDate(acc.last_updated) : undefined}>
                              {relativeDate(acc.last_updated)}
                            </span>
                          </td>
                          <td>
                            <div className="flex items-center justify-end gap-0.5">
                              <button className={`btn btn-sm ${stale ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setUpdating({ item: acc, kind: 'account' })}>Update</button>
                              <button className="icon-btn" aria-label={`Balance history for ${acc.name}`} title="History (H)" onClick={() => setHistory({ id: acc.id, kind: 'account' })}><Icon name="chart" /></button>
                              <button className="icon-btn" aria-label={`Edit ${acc.name}`} title="Edit (E)" onClick={() => setAccountForm({ open: true, account: acc })}><Icon name="edit" /></button>
                              <button className="icon-btn danger" aria-label={`Delete ${acc.name}`} title="Delete" onClick={() => remove(acc, 'account')}><Icon name="trash" /></button>
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

          <Panel
            title="Debts"
            sub="Mortgages, loans and credit cards. They’re taken off your net worth and paid down in the forecast."
            actions={<button className="btn btn-sm btn-secondary" onClick={() => setDebtForm({ open: true, debt: null })}><Icon name="plus" size={15} /> Add debt</button>}
            flush
          >
            {debtRows.length === 0 ? (
              <p className="px-5 py-6 muted text-[14px]">No debts added. If you have a mortgage, student loan or car loan, adding it gives you a true net worth.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Debt</th><th>Type</th><th className="num">Owed</th>
                      {multiCurrency && <th className="num">In {displayCurrency}</th>}
                      <th className="num">Rate</th><th className="num">Payment</th><th>Paid off</th><th>Updated</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {debtRows.map(d => {
                      const months = monthsToPayoff(d.balance ?? 0, d.interest_rate ?? 0, d.monthly_payment ?? 0);
                      return (
                        <tr key={d.id} {...rowProps(d.id)}>
                          <td>
                            <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{d.name}</p>
                            <p className="text-[12.5px] faint">{d.lender || 'No lender set'}</p>
                          </td>
                          <td>
                            <span className="inline-flex items-center gap-2 whitespace-nowrap"><span className="swatch" style={{ background: typeColor(d.debt_type) }} />{DEBT_LABELS[d.debt_type] ?? 'Debt'}</span>
                          </td>
                          <td className="num font-semibold" style={{ color: 'var(--color-text)' }}>{money(d.balance ?? 0, d.currency)}</td>
                          {multiCurrency && <td className="num muted">{money(d.converted, displayCurrency)}</td>}
                          <td className="num">{(d.interest_rate ?? 0).toFixed(2)}%</td>
                          <td className="num">{money(d.monthly_payment ?? 0, d.currency)}<span className="faint text-[12px]"> a month</span></td>
                          <td>{months === null ? <span className="badge badge-bad">Not at this payment</span> : <span className="muted text-[13px]">{payoffLabel(months)}</span>}</td>
                          <td><span className="muted text-[13px]">{relativeDate(d.last_updated)}</span></td>
                          <td>
                            <div className="flex items-center justify-end gap-0.5">
                              <button className="btn btn-sm btn-secondary" onClick={() => setUpdating({ item: d, kind: 'debt' })}>Update</button>
                              <button className="icon-btn" aria-label={`Balance history for ${d.name}`} title="History (H)" onClick={() => setHistory({ id: d.id, kind: 'debt' })}><Icon name="chart" /></button>
                              <button className="icon-btn" aria-label={`Edit ${d.name}`} title="Edit (E)" onClick={() => setDebtForm({ open: true, debt: d })}><Icon name="edit" /></button>
                              <button className="icon-btn danger" aria-label={`Delete ${d.name}`} title="Delete" onClick={() => remove(d, 'debt')}><Icon name="trash" /></button>
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

          <section className="panel">
            <div className="stat-row" style={{ ['--cols' as any]: 3 }}>
              <div><p className="stat-label">Accounts</p><p className="stat-value mt-1">{money(totalAssets, displayCurrency)}</p></div>
              <div><p className="stat-label">Debts</p><p className="stat-value mt-1">{totalDebts > 0 ? `−${money(totalDebts, displayCurrency)}` : money(0, displayCurrency)}</p></div>
              <div><p className="stat-label">Net worth</p><p className="stat-value mt-1">{money(totalAssets - totalDebts, displayCurrency)}</p></div>
            </div>
            {multiCurrency && <p className="px-5 pb-3 text-[12.5px] faint">Converted to {displayCurrency} at today’s exchange rates.</p>}
          </section>
        </div>
      )}

      <AccountFormDialog
        open={accountForm.open}
        account={accountForm.account}
        ctx={ctx}
        onClose={() => setAccountForm({ open: false, account: null })}
        onSaved={() => { setAccountForm({ open: false, account: null }); load(); toast.notify('Account saved'); }}
      />
      <DebtFormDialog
        open={debtForm.open}
        debt={debtForm.debt}
        displayCurrency={displayCurrency}
        onClose={() => setDebtForm({ open: false, debt: null })}
        onSaved={() => { setDebtForm({ open: false, debt: null }); load(); toast.notify('Debt saved'); }}
      />
      <UpdateBalanceDialog
        item={updating?.item ?? null}
        kind={updating?.kind}
        onClose={() => setUpdating(null)}
        onSaved={() => { setUpdating(null); load(); toast.notify('Balance updated'); }}
      />
      <HistoryDialog item={historyItem} kind={history?.kind} onClose={() => setHistory(null)} onChanged={load} />
      <ImportDialog
        open={importing}
        existing={accounts}
        displayCurrency={displayCurrency}
        onClose={() => setImporting(false)}
        onDone={msg => { setImporting(false); load(); toast.notify(msg); }}
      />
    </div>
  );
}
