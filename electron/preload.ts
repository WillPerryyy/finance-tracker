import { contextBridge, ipcRenderer } from 'electron';

/**
 * Exposes a typed API to the React renderer via window.electronAPI.
 * This is the ONLY bridge between the privileged main process and the
 * sandboxed renderer — contextIsolation keeps Node.js APIs out of React.
 */
contextBridge.exposeInMainWorld('electronAPI', {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  createProfile: (name: string) => ipcRenderer.invoke('profiles:create', name),
  getCurrentProfile: () => ipcRenderer.invoke('profiles:current'),
  selectProfile: (id: string) => ipcRenderer.invoke('profiles:select', id),
  deleteProfile: (id: string) => ipcRenderer.invoke('profiles:delete', id),
});
