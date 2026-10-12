import { useMemo, useState } from 'react';
import Modal from '../shared/Modal';
import { createAccount, updateAccount } from '../../api/client';
import { TYPE_LABELS } from '../../lib/accountTypes';
import { money, todayIso } from '../../lib/format';

/** Minimal CSV parser: handles quoted fields, escaped quotes and CRLF line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

const toNumber = (s: string) => {
  const n = parseFloat(String(s).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
};

function guessType(text: string): string {
  const t = text.toLowerCase();
  if (/roth/.test(t) && /ira/.test(t)) return 'roth_ira';
  if (/ira/.test(t)) return 'traditional_ira';
  if (/401/.test(t)) return '401k';
  if (/403/.test(t)) return '403b';
  if (/457/.test(t)) return '457b';
  if (/hsa|health/.test(t)) return 'hsa';
  if (/529/.test(t)) return '529';
  if (/check/.test(t)) return 'checking';
  if (/sav|cash|money market/.test(t)) return 'cash';
  if (/crypto|bitcoin|coin/.test(t)) return 'crypto';
  return 'brokerage';
}

const findCol = (headers: string[], ...patterns: RegExp[]) =>
  headers.findIndex(h => patterns.some(p => p.test(h.toLowerCase())));

export function ImportDialog({ open, existing, displayCurrency, onClose, onDone }: {
  open: boolean; existing: any[]; displayCurrency: string; onClose: () => void; onDone: (summary: string) => void;
}) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [nameCol, setNameCol] = useState(-1);
  const [valueCol, setValueCol] = useState(-1);
  const [typeCol, setTypeCol] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setRows(null); setFileName(''); setError(null); };

  const onFile = async (file: File) => {
    setError(null);
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) { setError('That file has no rows to import. It needs a header row and at least one account.'); return; }
    const h = parsed[0];
    setRows(parsed);
    setFileName(file.name);
    setNameCol(Math.max(0, findCol(h, /account.*name/, /^name$/, /description/, /account/)));
    setValueCol(findCol(h, /balance/, /current value/, /market value/, /^value$/, /total/));
    setTypeCol(findCol(h, /type/, /registration/));
  };

  const headers = rows?.[0] ?? [];
  const preview = useMemo(() => {
    if (!rows || nameCol < 0 || valueCol < 0) return [];
    const byName = new Map(existing.map(a => [a.name.trim().toLowerCase(), a]));
    return rows.slice(1).map(r => {
      const name = (r[nameCol] ?? '').trim();
      const value = toNumber(r[valueCol] ?? '');
      const match = byName.get(name.toLowerCase());
      return { name, value, match, type: guessType(`${typeCol >= 0 ? r[typeCol] : ''} ${name}`) };
    }).filter(p => p.name && p.value !== null);
  }, [rows, nameCol, valueCol, typeCol, existing]);

  const run = async () => {
    setBusy(true);
    let created = 0, updated = 0;
    try {
      for (const p of preview) {
        if (p.match) { await updateAccount(p.match.id, { value: p.value, last_updated: todayIso() }); updated++; }
        else { await createAccount({ name: p.name, account_type: p.type, currency: displayCurrency, value: p.value, last_updated: todayIso() }); created++; }
      }
      onDone(`Imported ${created} new ${created === 1 ? 'account' : 'accounts'} and updated ${updated}.`);
      reset();
    } catch (err: any) {
      setError(err?.message ?? 'The import stopped part way. Check your accounts and try again.');
    } finally { setBusy(false); }
  };

  return (
    <Modal
      isOpen={open}
      onClose={() => { reset(); onClose(); }}
      title="Import balances from a CSV file"
      subtitle="Most banks and brokers can export positions or balances as CSV."
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-negative">{error}</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => { reset(); onClose(); }}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || preview.length === 0} onClick={run}>
              {busy ? 'Importing…' : `Import ${preview.length || ''} ${preview.length === 1 ? 'row' : 'rows'}`}
            </button>
          </div>
        </div>
      }
    >
      {!rows ? (
        <label className="block rounded-lg px-6 py-10 text-center cursor-pointer" style={{ border: '2px dashed var(--color-border-2)' }}>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} data-autofocus />
          <p className="section-title">Choose a CSV file</p>
          <p className="muted text-[13.5px] mt-1">It needs one row per account, with a column for the name and one for the balance.</p>
        </label>
      ) : (
        <div className="space-y-4">
          <p className="text-[13.5px] muted">{fileName}: {rows.length - 1} rows. Rows whose name matches an existing account update its balance; the rest become new accounts in {displayCurrency}.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ColumnPicker id="imp-name" label="Account name column" headers={headers} value={nameCol} onChange={setNameCol} />
            <ColumnPicker id="imp-value" label="Balance column" headers={headers} value={valueCol} onChange={setValueCol} />
            <ColumnPicker id="imp-type" label="Account type column (optional)" headers={headers} value={typeCol} onChange={setTypeCol} optional />
          </div>
          {preview.length > 0 ? (
            <div className="panel overflow-hidden" style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table className="data-table">
                <thead><tr><th>Name</th><th>Will be</th><th className="num">Balance</th></tr></thead>
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i}>
                      <td>{p.name}</td>
                      <td>{p.match ? <span className="badge badge-info">Update existing</span> : <span className="badge badge-plain">New {TYPE_LABELS[p.type]}</span>}</td>
                      <td className="num">{money(p.value ?? 0, p.match?.currency ?? displayCurrency, { cents: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="callout callout-warn">No rows have both a name and a number in the columns chosen.</p>
          )}
          <button type="button" className="link-btn text-[13px]" onClick={reset}>Choose a different file</button>
        </div>
      )}
    </Modal>
  );
}

function ColumnPicker({ id, label, headers, value, onChange, optional }: {
  id: string; label: string; headers: string[]; value: number; onChange: (n: number) => void; optional?: boolean;
}) {
  return (
    <div>
      <label className="form-label" htmlFor={id}>{label}</label>
      <select id={id} className="form-input" value={value} onChange={e => onChange(Number(e.target.value))}>
        {optional ? <option value={-1}>None</option> : <option value={-1} disabled>Choose a column</option>}
        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </select>
    </div>
  );
}
