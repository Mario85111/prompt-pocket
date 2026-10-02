import { contextBridge, ipcRenderer } from 'electron';
import type { AgentProgress, AgentsApi, CatalogApi, PocketApi, QA } from '../shared/types';

const catalog: CatalogApi = {
  getRoot: () => ipcRenderer.invoke('catalog:getRoot'),
  listFamilies: () => ipcRenderer.invoke('catalog:listFamilies'),
  createFamily: (title: string) => ipcRenderer.invoke('catalog:createFamily', title),
  createVersionFrom: (parentRelPath: string) =>
    ipcRenderer.invoke('catalog:createVersionFrom', parentRelPath),
  setWorkingVersion: (relPath: string) => ipcRenderer.invoke('catalog:setWorkingVersion', relPath),
  saveVersionBody: (relPath: string, body: string) =>
    ipcRenderer.invoke('catalog:saveVersionBody', relPath, body),
  saveVersionNote: (relPath: string, note: string) =>
    ipcRenderer.invoke('catalog:saveVersionNote', relPath, note),
  search: (query: string) => ipcRenderer.invoke('catalog:search', query),
  appendVersion: (familySlug: string, body: string) =>
    ipcRenderer.invoke('catalog:appendVersion', familySlug, body),
  createFamilyWithBody: (title: string, body: string) =>
    ipcRenderer.invoke('catalog:createFamilyWithBody', title, body),
  exportVersion: (relPath: string) => ipcRenderer.invoke('catalog:exportVersion', relPath),
  exportFamily: (slug: string) => ipcRenderer.invoke('catalog:exportFamily', slug),
  importFiles: () => ipcRenderer.invoke('catalog:importFiles'),
  deleteVersion: (relPath: string) => ipcRenderer.invoke('catalog:deleteVersion', relPath),
  deleteFamily: (slug: string, title: string) => ipcRenderer.invoke('catalog:deleteFamily', slug, title),
  revealRoot: () => ipcRenderer.invoke('catalog:revealRoot'),
};

/** Klucz API przechodzi tędy tylko w jedną stronę: do zapisania. Renderer nie ma jak go odczytać. */
const agents: AgentsApi = {
  hasApiKey: (mode) => ipcRenderer.invoke('agents:hasApiKey', mode),
  setApiKey: (mode, key) => ipcRenderer.invoke('agents:setApiKey', mode, key),
  clearApiKey: (mode) => ipcRenderer.invoke('agents:clearApiKey', mode),
  getConfig: () => ipcRenderer.invoke('agents:getConfig'),
  listProviders: () => ipcRenderer.invoke('agents:listProviders'),
  setConfig: (config) => ipcRenderer.invoke('agents:setConfig', config),
  write: (task: string, answers: QA[]) => ipcRenderer.invoke('agents:write', task, answers),
  audit: (task: string, draft: string, answers: QA[]) =>
    ipcRenderer.invoke('agents:audit', task, draft, answers),
  onProgress: (cb) => {
    const handler = (_e: unknown, payload: AgentProgress) => cb(payload);
    ipcRenderer.on('agents:progress', handler);
    return () => ipcRenderer.removeListener('agents:progress', handler);
  },
};

const pocket: PocketApi = {
  copyAndMarkUsed: (relPath, text) => ipcRenderer.invoke('pocket:copyAndMarkUsed', relPath, text),
  getShortcut: () => ipcRenderer.invoke('pocket:getShortcut'),
  getBackup: () => ipcRenderer.invoke('pocket:getBackup'),
  chooseBackupDir: () => ipcRenderer.invoke('pocket:chooseBackupDir'),
  setBackupAuto: (auto) => ipcRenderer.invoke('pocket:setBackupAuto', auto),
  backupNow: () => ipcRenderer.invoke('pocket:backupNow'),
  hideQuick: () => ipcRenderer.invoke('pocket:hideQuick'),
  onQuickShown: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('pocket:quickShown', handler);
    return () => ipcRenderer.removeListener('pocket:quickShown', handler);
  },
};

contextBridge.exposeInMainWorld('catalog', catalog);
contextBridge.exposeInMainWorld('agents', agents);
contextBridge.exposeInMainWorld('pocket', pocket);
