import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as store from './store';
import * as settings from './settings';
import * as agents from './agents';
import * as providers from './providers';
import type { QA } from '../shared/types';

const isDev = process.env.NODE_ENV === 'development';

/**
 * SCOPE §4: katalog w Documents — ale §7 zabrania, by dane opuszczały maszynę.
 *
 * Na tej maszynie folder Dokumenty jest przekierowany do OneDrive, więc te dwa
 * wymagania się wykluczają. Wygrywa ograniczenie, nie preferencja: katalog ląduje
 * w profilu użytkownika, poza folderem synchronizowanym. Decyzja do potwierdzenia
 * przez product ownera — nadpisanie zmienną PROMPT_POCKET_ROOT (dawniej KATALOG_PROMPTOW_ROOT).
 */
async function resolveRoot(): Promise<string> {
  const override = process.env.PROMPT_POCKET_ROOT || process.env.KATALOG_PROMPTOW_ROOT;
  if (override) return override;

  const documents = app.getPath('documents');
  const syncedToCloud = /[\\/]OneDrive([\\/]|$)/i.test(documents);
  const base = syncedToCloud ? app.getPath('home') : documents;
  const root = path.join(base, 'PromptPocket');

  // Aplikacja nazywała się kiedyś „Katalog Promptów". Stary katalog przenosimy raz,
  // przy pierwszym uruchomieniu po zmianie nazwy — i tylko gdy nowego jeszcze nie ma,
  // żeby niczego nie nadpisać.
  const legacy = path.join(base, 'KatalogPromptow');
  if (!(await exists(root)) && (await exists(legacy))) {
    await fs.rename(legacy, root);
  }
  return root;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

/**
 * Katalog danych aplikacji (klucze, wybór dostawcy, skórka) wynika z pola `name`
 * w package.json — zmiana nazwy przeniosła go z `katalog-promptow` do `prompt-pocket`.
 * Kopiujemy ustawienia ze starego miejsca, jeśli nowe jest jeszcze puste. Klucze są
 * zaszyfrowane DPAPI dla tego samego użytkownika systemu, więc kopia pozostaje czytelna.
 */
async function migrateLegacyUserData(): Promise<void> {
  const current = app.getPath('userData');
  const legacy = path.join(app.getPath('appData'), 'katalog-promptow');
  if (current === legacy || !(await exists(legacy))) return;
  if (await exists(path.join(current, 'provider.json'))) return;

  await fs.mkdir(current, { recursive: true });
  for (const entry of await fs.readdir(legacy)) {
    if (/^provider(-key-.+\.bin|\.json)$/.test(entry) || entry === 'Local Storage') {
      await fs.cp(path.join(legacy, entry), path.join(current, entry), {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
    }
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    // Okno pokazujemy dopiero, gdy strona jest gotowa — inaczej przy ciemnych skórkach
    // (Matrix, Speed Night) mignąłby jasny prostokąt w kolorze domyślnego motywu.
    show: false,
    title: 'Prompt Pocket',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // SCOPE: zero wywołań sieciowych w MVP. W dev ładujemy serwer Vite z localhosta.
  if (isDev) {
    void win.loadURL('http://localhost:5173');
  } else {
    // dist-electron/main/ → korzeń projektu → dist/
    void win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  await migrateLegacyUserData();
  store.setRoot(await resolveRoot());
  // Kosz systemowy zamiast kasowania na amen — usunięcie promptu ma być odwracalne.
  store.setRemover((absPath) => shell.trashItem(absPath));
  await store.ensureRoot();

  ipcMain.handle('catalog:getRoot', () => store.getRoot());
  ipcMain.handle('catalog:listFamilies', () => store.listFamilies());
  ipcMain.handle('catalog:createFamily', (_e, title: string) => store.createFamily(title));
  ipcMain.handle('catalog:createVersionFrom', (_e, parentRelPath: string) =>
    store.createVersionFrom(parentRelPath)
  );
  ipcMain.handle('catalog:setWorkingVersion', (_e, relPath: string) => store.setWorkingVersion(relPath));
  ipcMain.handle('catalog:saveVersionBody', (_e, relPath: string, body: string) =>
    store.saveVersionBody(relPath, body)
  );
  ipcMain.handle('catalog:search', (_e, query: string) => store.search(query));
  ipcMain.handle('catalog:appendVersion', (_e, slug: string, body: string) =>
    store.appendVersionToFamily(slug, body)
  );
  ipcMain.handle('catalog:createFamilyWithBody', (_e, title: string, body: string) =>
    store.createFamilyWithBody(title, body)
  );
  ipcMain.handle('catalog:revealRoot', () => shell.openPath(store.getRoot()));

  /* ---------- import i eksport ---------- */

  const zapisz = async (event: Electron.IpcMainInvokeEvent, name: string, content: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(window ?? undefined!, {
      defaultPath: name,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return false;
    await fs.writeFile(filePath, content, 'utf8');
    return true;
  };

  ipcMain.handle('catalog:exportVersion', async (event, relPath: string) => {
    const { name, content } = await store.exportVersion(relPath);
    return zapisz(event, name, content);
  });

  ipcMain.handle('catalog:exportFamily', async (event, slug: string) => {
    const { name, content } = await store.exportFamily(slug);
    return zapisz(event, name, content);
  });

  /** Każdy wskazany plik zakłada osobną rodzinę — nazwa pliku staje się nazwą rodziny. */
  ipcMain.handle('catalog:importFiles', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(window ?? undefined!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown i tekst', extensions: ['md', 'markdown', 'txt'] }],
    });
    if (canceled || filePaths.length === 0) return 0;

    let imported = 0;
    for (const file of filePaths) {
      const raw = await fs.readFile(file, 'utf8');
      const title = path.basename(file).replace(/\.(md|markdown|txt)$/i, '');
      await store.importAsFamily(title, raw);
      imported++;
    }
    return imported;
  });

  /**
   * Usuwanie idzie do kosza systemowego, nie w niebyt — pomyłka jest do odkręcenia
   * bez naszego udziału. Pytanie zadaje proces główny, więc interfejs nie ma jak
   * skasować czegokolwiek bez potwierdzenia.
   */
  ipcMain.handle('catalog:deleteVersion', async (event, relPath: string) => {
    const plan = await store.planVersionDeletion(relPath);
    const window = BrowserWindow.fromWebContents(event.sender);
    const detail = plan.wholeFamily
      ? `To ostatnia wersja, więc zniknie cała rodzina „${plan.familyTitle}".`
      : `Znikną wersje: ${plan.versions.join(', ')} — wraz z wywiedzionymi z nich.`;

    const { response } = await dialog.showMessageBox(window ?? undefined!, {
      type: 'warning',
      buttons: ['Anuluj', 'Przenieś do kosza'],
      defaultId: 0,
      cancelId: 0,
      message: 'Usunąć prompt?',
      detail: `${detail}\n\nPliki trafią do kosza systemowego — stamtąd da się je przywrócić.`,
    });
    if (response !== 1) return false;

    await store.deleteVersion(relPath);
    return true;
  });

  ipcMain.handle('catalog:deleteFamily', async (event, slug: string, title: string) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { response } = await dialog.showMessageBox(window ?? undefined!, {
      type: 'warning',
      buttons: ['Anuluj', 'Przenieś do kosza'],
      defaultId: 0,
      cancelId: 0,
      message: `Usunąć całą rodzinę „${title}"?`,
      detail: 'Znikną wszystkie jej wersje.\n\nPliki trafią do kosza systemowego — stamtąd da się je przywrócić.',
    });
    if (response !== 1) return false;

    await store.deleteFamily(slug);
    return true;
  });

  /* M2 — agenci. Klucz API zostaje w procesie głównym; renderer wie tylko, czy istnieje. */
  ipcMain.handle('agents:hasApiKey', (_e, mode: settings.KeyedMode) => settings.hasApiKey(mode));
  ipcMain.handle('agents:setApiKey', (_e, mode: settings.KeyedMode, key: string) =>
    settings.setApiKey(mode, key)
  );
  ipcMain.handle('agents:clearApiKey', (_e, mode: settings.KeyedMode) => settings.clearApiKey(mode));
  ipcMain.handle('agents:getConfig', () => settings.getConfig());
  ipcMain.handle('agents:listProviders', () =>
    Object.entries(providers.PROVIDERS).map(([id, spec]) => ({
      id,
      label: spec.label,
      modelHint: spec.modelHint,
      keyHint: spec.keyHint,
    }))
  );
  ipcMain.handle('agents:setConfig', (_e, config: settings.ProviderConfig) => settings.setConfig(config));
  /** Postęp wraca do tego okna, które zleciło pracę — inaczej licznik trafiłby w próżnię. */
  const progress = (event: Electron.IpcMainInvokeEvent, phase: 'pisarz' | 'audytor') => (chars: number) => {
    if (!event.sender.isDestroyed()) event.sender.send('agents:progress', { phase, chars });
  };

  ipcMain.handle('agents:write', async (event, task: string, answers: QA[]) => {
    try {
      return await agents.writePrompt(task, answers, progress(event, 'pisarz'));
    } catch (err) {
      throw new Error(agents.describeError(err));
    }
  });
  ipcMain.handle('agents:audit', async (event, task: string, draft: string, answers: QA[]) => {
    try {
      return await agents.auditPrompt(task, draft, answers, progress(event, 'audytor'));
    } catch (err) {
      throw new Error(agents.describeError(err));
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
