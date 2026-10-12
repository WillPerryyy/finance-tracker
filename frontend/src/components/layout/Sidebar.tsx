import { NavLink, useNavigate } from 'react-router-dom';
import { useElectron } from '../../contexts/ElectronContext';

const NAV_ITEMS = [
  { to: '/',            label: 'Dashboard',  end: true  },
  { to: '/accounts',    label: 'Accounts',   end: false },
  { to: '/projections', label: 'Forecast',   end: false },
  { to: '/retirement',  label: 'Retirement', end: false },
  { to: '/settings',    label: 'Settings',   end: false },
];

export default function Sidebar() {
  const { profile } = useElectron();
  const navigate = useNavigate();

  return (
    <header className="w-full sticky top-0 z-40" style={{ background: 'var(--color-nav)' }}>
      <div className="max-w-[1280px] mx-auto px-6 h-14 flex items-center gap-8">
        <NavLink to="/" className="flex items-center gap-2.5 shrink-0" aria-label="Finance Tracker, go to dashboard">
          <span
            className="w-7 h-7 rounded-md flex items-center justify-center text-white text-[12px] font-bold"
            style={{ background: 'var(--color-accent)' }}
            aria-hidden="true"
          >
            FT
          </span>
          <span className="text-white font-semibold text-[15px]">Finance Tracker</span>
        </NavLink>

        <nav className="flex items-center gap-1 flex-1" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-[14px] font-medium transition-colors ${
                  isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {profile && (
          <button
            onClick={() => navigate('/profiles')}
            className="flex items-center gap-2 shrink-0 rounded-md pl-1.5 pr-2.5 py-1 text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            title="Switch profile"
          >
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold text-white"
              style={{ background: 'var(--color-nav-active)' }}
              aria-hidden="true"
            >
              {profile.name.charAt(0).toUpperCase()}
            </span>
            <span className="text-[13.5px]">{profile.name}</span>
            <span className="text-[12px] text-white/50">Switch</span>
          </button>
        )}
      </div>
    </header>
  );
}
