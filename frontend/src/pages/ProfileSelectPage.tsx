import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useElectron } from '../contexts/ElectronContext';
import { profilesApi } from '../api/client';
import { Icon, ConfirmDialog } from '../components/ui';
import { longDate } from '../lib/format';

interface ProfileEntry { id: string; name: string; created: string; data_dir?: string }

export default function ProfileSelectPage() {
  const { setProfile, refreshProfile } = useElectron();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<ProfileEntry[]>([]);
  const [activeId, setActiveId] = useState('default');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<ProfileEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, []);
  useEffect(() => { if (creating) nameRef.current?.focus(); }, [creating]);
  useEffect(() => { if (renamingId) renameRef.current?.select(); }, [renamingId]);

  async function load() {
    setError(null);
    try {
      const data = await profilesApi.list();
      setProfiles(data.profiles ?? []);
      setActiveId(data.active_id ?? 'default');
    } catch {
      setError('Profiles couldn’t be loaded. Close and reopen the app to restart the background service.');
    } finally { setLoading(false); }
  }

  async function open(id: string) {
    setSwitching(id); setError(null);
    try {
      const result = await profilesApi.activate(id);
      if (result?.profile) {
        setProfile({ id: result.profile.id, name: result.profile.name, created: result.profile.created, lastUsed: null, dataDir: result.profile.data_dir ?? '' });
        setActiveId(id);
      }
      navigate('/');
    } catch {
      setError('That profile couldn’t be opened. Try again.');
    } finally { setSwitching(null); }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      const created = await profilesApi.create(name);
      setCreating(false); setNewName('');
      await open(created.id);
    } catch { setError('The profile couldn’t be created. Try again.'); }
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!renamingId || !renameValue.trim()) return;
    try {
      const updated = await profilesApi.rename(renamingId, renameValue.trim());
      if (renamingId === activeId) setProfile({ id: updated.id, name: updated.name, created: updated.created, lastUsed: null, dataDir: updated.data_dir ?? '' });
    } catch { setError('The profile couldn’t be renamed.'); }
    finally { setRenamingId(null); load(); }
  }

  async function remove() {
    if (!deleting) return;
    try {
      await profilesApi.remove(deleting.id);
      if (deleting.id === activeId) { refreshProfile(); setActiveId('default'); }
      load();
    } catch { setError('The profile couldn’t be deleted.'); }
    finally { setDeleting(null); }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-[460px]">
        <div className="flex items-center gap-3 mb-8">
          <span className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold" style={{ background: 'var(--color-nav)' }} aria-hidden="true">FT</span>
          <div>
            <h1 className="page-title" style={{ fontSize: 22 }}>Who’s using Finance Tracker?</h1>
            <p className="muted text-[14px]">Each profile keeps its own accounts and plan.</p>
          </div>
        </div>

        {error && <div className="callout callout-warn mb-4">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-12"><div className="spinner" /></div>
        ) : (
          <div className="panel overflow-hidden">
            <ul>
              {profiles.map((p, i) => (
                <li key={p.id} className="px-5 py-4" style={i > 0 ? { borderTop: '1px solid var(--color-border)' } : undefined}>
                  {renamingId === p.id ? (
                    <form onSubmit={rename} className="flex gap-2">
                      <input ref={renameRef} aria-label="Profile name" className="form-input" value={renameValue} maxLength={50} onChange={e => setRenameValue(e.target.value)} />
                      <button type="submit" className="btn btn-primary" disabled={!renameValue.trim()}>Save</button>
                      <button type="button" className="btn btn-ghost" onClick={() => setRenamingId(null)}>Cancel</button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="w-9 h-9 rounded-full flex items-center justify-center text-[14px] font-semibold shrink-0"
                        style={{ background: p.id === activeId ? 'var(--color-accent)' : 'var(--color-surface-3)', color: p.id === activeId ? '#fff' : 'var(--color-text-2)' }} aria-hidden="true">
                        {p.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate" style={{ color: 'var(--color-text)' }}>{p.name}</p>
                        <p className="text-[12.5px] faint">{p.id === activeId ? 'Open now' : `Created ${longDate(p.created?.slice(0, 10))}`}</p>
                      </div>
                      <button className="icon-btn" aria-label={`Rename ${p.name}`} title="Rename" onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}><Icon name="edit" /></button>
                      {p.id !== 'default' && (
                        <button className="icon-btn danger" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => setDeleting(p)}><Icon name="trash" /></button>
                      )}
                      <button className={`btn btn-sm ${p.id === activeId ? 'btn-secondary' : 'btn-primary'}`} style={{ minWidth: 84 }} disabled={switching !== null} onClick={() => open(p.id)}>
                        {switching === p.id ? 'Opening…' : p.id === activeId ? 'Continue' : 'Open'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            <div className="px-5 py-4" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface-2)' }}>
              {creating ? (
                <form onSubmit={create} className="flex gap-2">
                  <input ref={nameRef} aria-label="New profile name" className="form-input" value={newName} maxLength={50} placeholder="Name, for example Alex or Joint" onChange={e => setNewName(e.target.value)} />
                  <button type="submit" className="btn btn-primary" disabled={!newName.trim()}>Create</button>
                  <button type="button" className="btn btn-ghost" onClick={() => { setCreating(false); setNewName(''); }}>Cancel</button>
                </form>
              ) : (
                <button className="btn btn-ghost" style={{ paddingLeft: 0 }} onClick={() => setCreating(true)}>
                  <Icon name="plus" size={16} /> Add a profile
                </button>
              )}
            </div>
          </div>
        )}

        {profiles.length > 0 && (
          <button className="link-btn text-[13.5px] mt-4" onClick={() => navigate('/')}>Back to the app</button>
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.name}?`}
        body="All accounts, life events and settings in this profile will be permanently deleted. This can’t be undone."
        confirmLabel="Delete profile"
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
      />
    </div>
  );
}
