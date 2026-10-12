import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import PageLayout from './components/layout/PageLayout';
import DashboardPage from './pages/DashboardPage';
import AccountsPage from './pages/AccountsPage';
import ProjectionsPage from './pages/ProjectionsPage';
import RetirementPage from './pages/RetirementPage';
import SettingsPage from './pages/SettingsPage';
import ProfileSelectPage from './pages/ProfileSelectPage';
import OnboardingPage from './pages/OnboardingPage';
import { ElectronProvider, useElectron } from './contexts/ElectronContext';
import { ToastProvider } from './components/chrome';
import { getSettings } from './api/client';

/** Sends a profile that hasn't been set up yet to the onboarding steps. */
function SetupGuard() {
  const { isElectron } = useElectron();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (location.pathname === '/profiles' || location.pathname === '/welcome') return;
    getSettings().then(s => {
      if (!s?.birth_year && !s?.onboarded) navigate('/welcome', { replace: true });
    }).catch(() => {});
    if (isElectron) {
      (window as any).electronAPI.getCurrentProfile().then((p: any) => {
        if (!p) navigate('/profiles', { replace: true });
      }).catch(() => {});
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Each page opens at the top, rather than wherever the previous page was scrolled to. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <SetupGuard />
      <Routes>
        <Route path="/profiles" element={<ProfileSelectPage />} />
        <Route path="/welcome" element={<OnboardingPage />} />
        <Route
          path="/*"
          element={
            <PageLayout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/accounts" element={<AccountsPage />} />
                <Route path="/projections" element={<ProjectionsPage />} />
                <Route path="/retirement" element={<RetirementPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </PageLayout>
          }
        />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <ElectronProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </ElectronProvider>
  );
}
