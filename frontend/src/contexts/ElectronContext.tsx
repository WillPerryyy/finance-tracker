import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { profilesApi } from '../api/client';

export interface Profile {
  id: string;
  name: string;
  created: string;
  lastUsed: string | null;
  dataDir: string;
}

interface ElectronContextType {
  isElectron: boolean;
  profile: Profile | null;
  setProfile: (p: Profile | null) => void;
  refreshProfile: () => void;
}

const ElectronContext = createContext<ElectronContextType>({
  isElectron: false,
  profile: null,
  setProfile: () => {},
  refreshProfile: () => {},
});

function toProfile(p: any): Profile {
  return {
    id:       p.id,
    name:     p.name,
    created:  p.created,
    lastUsed: p.lastUsed ?? p.last_used ?? null,
    dataDir:  p.dataDir ?? p.data_dir ?? '',
  };
}

export function ElectronProvider({ children }: { children: ReactNode }) {
  const isElectron = typeof window !== 'undefined' && 'electronAPI' in window;
  const [profile, setProfile] = useState<Profile | null>(null);

  const refreshProfile = () => {
    if (isElectron) {
      // Electron mode: IPC (best-effort; may return null if main.ts handlers not wired)
      (window as any).electronAPI.getCurrentProfile()
        .then((p: any) => { if (p) setProfile(toProfile(p)); })
        .catch(() => {});
      // Also fall back to the backend API
      profilesApi.list()
        .then((data: any) => {
          const activeId = data.active_id;
          const active = (data.profiles ?? []).find((p: any) => p.id === activeId);
          if (active) setProfile(toProfile(active));
        })
        .catch(() => {});
    } else {
      // Browser mode: fetch active profile from backend
      profilesApi.list()
        .then((data: any) => {
          const activeId = data.active_id;
          const active = (data.profiles ?? []).find((p: any) => p.id === activeId);
          if (active) setProfile(toProfile(active));
        })
        .catch(() => {});
    }
  };

  useEffect(() => {
    refreshProfile();
  }, [isElectron]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ElectronContext.Provider value={{ isElectron, profile, setProfile, refreshProfile }}>
      {children}
    </ElectronContext.Provider>
  );
}

export const useElectron = () => useContext(ElectronContext);
