import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { ReminderBanner, GlobalShortcuts } from '../chrome';
import { getAccounts, getSettings } from '../../api/client';

export default function PageLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [reminder, setReminder] = useState<any>();

  useEffect(() => {
    getAccounts().then(setAccounts).catch(() => {});
    getSettings().then(s => setReminder(s?.reminder)).catch(() => {});
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex flex-col">
      <Sidebar />
      <GlobalShortcuts />
      <main className="flex-1 min-w-0">
        <div className="max-w-[1280px] mx-auto px-6 pt-8 pb-16">
          {location.pathname !== '/accounts' && <ReminderBanner reminder={reminder} accounts={accounts} />}
          {children}
        </div>
      </main>
    </div>
  );
}
