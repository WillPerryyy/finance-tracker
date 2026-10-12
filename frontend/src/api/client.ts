// In Electron, there is no Vite proxy, so we use the absolute backend URL.
// In browser dev mode, '/api' is proxied by Vite to http://127.0.0.1:8200.
const isElectron = typeof window !== 'undefined' && 'electronAPI' in window;
const BASE = isElectron ? 'http://127.0.0.1:8200/api' : '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

// Accounts (high-level account tracking)
export const getAccounts = () => request<any[]>('/accounts');
export const createAccount = (data: any) =>
  request<any>('/accounts', { method: 'POST', body: JSON.stringify(data) });
export const updateAccount = (id: string, data: any) =>
  request<any>(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAccount = (id: string) =>
  request<any>(`/accounts/${id}`, { method: 'DELETE' });
export const getAccountTypes = () => request<Record<string, string>>('/accounts/types');

// Assets (legacy — kept for reference, not used in UI)
export const getAccount = (account: string) => request<any>(`/assets/${account}`);
export const getOpenPositions = (account: string) => request<any[]>(`/assets/${account}/positions/open`);
export const getPositions = (account: string, status?: string) =>
  request<any[]>(`/assets/${account}/positions${status ? `?status=${status}` : ''}`);
export const createPosition = (account: string, data: any) =>
  request<any>(`/assets/${account}/positions`, { method: 'POST', body: JSON.stringify(data) });
export const updatePosition = (account: string, id: string, data: any) =>
  request<any>(`/assets/${account}/positions/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deletePosition = (account: string, id: string) =>
  request<any>(`/assets/${account}/positions/${id}`, { method: 'DELETE' });
export const quickUpdate = (account: string, totalValue: number) =>
  request<any>(`/assets/${account}/quick-update`, { method: 'POST', body: JSON.stringify({ total_value: totalValue }) });

export const getTransactions = (account: string, params?: Record<string, string>) => {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return request<any[]>(`/assets/${account}/transactions${qs}`);
};
export const createTransaction = (account: string, data: any) =>
  request<any>(`/assets/${account}/transactions`, { method: 'POST', body: JSON.stringify(data) });
export const updateTransaction = (account: string, id: string, data: any) =>
  request<any>(`/assets/${account}/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTransaction = (account: string, id: string) =>
  request<any>(`/assets/${account}/transactions/${id}`, { method: 'DELETE' });

// Projections
export const getProjections = () => request<any>('/projections');
export const updateProjections = (data: any) =>
  request<any>('/projections', { method: 'PUT', body: JSON.stringify(data) });
export const updateProjectionSettings = (data: any) =>
  request<any>('/projections/settings', { method: 'PUT', body: JSON.stringify(data) });
export const updateProjectionCategory = (catId: string, data: any) =>
  request<any>(`/projections/categories/${catId}`, { method: 'PUT', body: JSON.stringify(data) });
export const getProjectionSummary = () => request<any>('/projections/summary');
export const getForecast = () => request<any>('/projections/forecast');
export const getCombinedForecast = (body: {
  extra_data_dirs?: string[];
  extra_accounts?: any[];
  profile_labels?: string[];
}) => request<any>('/projections/combined-forecast', { method: 'POST', body: JSON.stringify(body) });

// Alternatives
export const getAlternatives = () => request<any[]>('/alternatives');
export const createAlternative = (data: any) =>
  request<any>('/alternatives', { method: 'POST', body: JSON.stringify(data) });
export const updateAlternative = (id: string, data: any) =>
  request<any>(`/alternatives/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAlternative = (id: string) =>
  request<any>(`/alternatives/${id}`, { method: 'DELETE' });

// Travel
export const getTravel = () => request<any[]>('/travel');
export const createTravel = (data: any) =>
  request<any>('/travel', { method: 'POST', body: JSON.stringify(data) });
export const updateTravel = (id: string, data: any) =>
  request<any>(`/travel/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTravel = (id: string) =>
  request<any>(`/travel/${id}`, { method: 'DELETE' });
export const getResidencySummary = (year?: number) =>
  request<any[]>(`/travel/residency-summary${year ? `?year=${year}` : ''}`);
export const getKnownLocations = () => request<any>('/travel/locations');

// Exchange rates & market
export const getExchangeRates = () => request<any>('/exchange-rates');
export const refreshExchangeRates = () => request<any>('/exchange-rates/refresh', { method: 'POST' });
export const getMarketPrices = () => request<any>('/market/prices');
export const refreshMarketPrices = () => request<any>('/market/refresh', { method: 'POST' });

// Dashboard
export const getNetWorth = () => request<any>('/dashboard/net-worth');
export const getAllocation = () => request<any>('/dashboard/allocation');

// Life Events
export const getLifeEvents = () => request<any[]>('/life-events');
export const getLifeEventMeta = () => request<any>('/life-events/meta');
export const createLifeEvent = (data: any) =>
  request<any>('/life-events', { method: 'POST', body: JSON.stringify(data) });
export const updateLifeEvent = (id: string, data: any) =>
  request<any>(`/life-events/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteLifeEvent = (id: string) =>
  request<any>(`/life-events/${id}`, { method: 'DELETE' });

// Settings
export const getSettings = () => request<any>('/settings');
export const updateSettings = (data: any) =>
  request<any>('/settings', { method: 'PUT', body: JSON.stringify(data) });

// Profiles
export const profilesApi = {
  list:     ()                   => request<any>('/profiles'),
  create:   (name: string)       => request<any>('/profiles', { method: 'POST', body: JSON.stringify({ name }) }),
  rename:   (id: string, name: string) => request<any>(`/profiles/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  activate: (id: string)         => request<any>(`/profiles/${id}/activate`, { method: 'POST' }),
  remove:   (id: string)         => request<any>(`/profiles/${id}`, { method: 'DELETE' }),
};

// Debts
export const getDebts = () => request<any[]>('/debts');
export const createDebt = (data: any) =>
  request<any>('/debts', { method: 'POST', body: JSON.stringify(data) });
export const updateDebt = (id: string, data: any) =>
  request<any>(`/debts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteDebt = (id: string) =>
  request<any>(`/debts/${id}`, { method: 'DELETE' });

// Backup
export const exportBackup = () => request<any>('/backup');
export const restoreBackup = (data: any) =>
  request<any>('/backup/restore', { method: 'POST', body: JSON.stringify(data) });
