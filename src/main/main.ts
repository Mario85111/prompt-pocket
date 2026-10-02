import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} from 'electron';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as store from './store';
import * as settings from './settings';
import * as agents from './agents';
import * as providers from './providers';
import * as backup from './backup';
import type { BackupState, QA } from '../shared/types';

const isDev = process.env.NODE_ENV === 'development';

/**
 * SCOPE §4: katalog w Documents — ale §7 zabrania, by dane opuszczały maszynę.
 *
 * Na tej maszynie folder Dokumenty jest przekierowany do OneDrive, więc te dwa
 * wymagania się wykluczają. Wygrywa ograniczenie, nie preferencja: katalog ląduje
 * w profilu użytkownika, poza folderem synchronizowanym. Decyzja do potwierdzenia
 * przez product ownera — nadpisanie zmienną PROMPT_POCKET_ROOT.
 */
function resolveRoot(): string {
  const override = process.env.PROMPT_POCKET_ROOT;
  if (override) return override;

  const documents = app.getPath('documents');
  const syncedToCloud = /[\\/]OneDrive([\\/]|$)/i.test(documents);

  return path.join(syncedToCloud ? app.getPath('home') : documents, 'PromptPocket');
}

/* ---------- okna ---------- */

/**
 * Globalny skrót do szybkiego szukania. Nie Ctrl+Shift+P — to paleta poleceń w VS Code
 * i wielu innych edytorach, a skrót globalny zabrałby go wszystkim programom.
 */
const SHORTCUT = 'CommandOrControl+Alt+P';
const SHORTCUT_LABEL = process.platform === 'darwin' ? '⌘⌥P' : 'Ctrl+Alt+P';
const QUICK_SIZE = { width: 640, height: 440 };

// Windows bierze ikonę z exe; okno i zasobnik na Linuksie potrzebują jej z pliku (build/ jest w paczce).
const ICON = path.join(__dirname, '../../build/icon.png');

let mainWin: BrowserWindow | null = null;
let quickWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let shortcutRegistered = false;

const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
};

/** Ten sam renderer obsługuje oba okna; okno szybkiego szukania rozpoznaje się po #quick. */
function loadRenderer(win: BrowserWindow, hash?: string): void {
  // SCOPE: zero wywołań sieciowych w MVP. W dev ładujemy serwer Vite z localhosta.
  if (isDev) {
    void win.loadURL(`http://localhost:5173${hash ? `#${hash}` : ''}`);
  } else {
    // dist-electron/main/ → korzeń projektu → dist/
    void win.loadFile(path.join(__dirname, '../../dist/index.html'), hash ? { hash } : undefined);
  }
}

/** Prosi okno o zapis zaległych zmian i czeka, aż skończy. */
async function flushWindow(win: BrowserWindow | null): Promise<void> {
  if (!win || win.isDestroyed()) return;
  try {
    await win.webContents.executeJavaScript('window.__ppFlush ? window.__ppFlush() : null', true);
  } catch {
    /* okno mogło nie zdążyć się załadować — wtedy nie ma czego zapisywać */
  }
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    // Okno pokazujemy dopiero, gdy strona jest gotowa — inaczej przy ciemnych skórkach
    // (Matrix, Speed Night) mignąłby jasny prostokąt w kolorze domyślnego motywu.
    show: false,
    title: 'Prompt Pocket',
    icon: ICON,
    webPreferences,
  });

  win.once('ready-to-show', () => win.show());

  // Zamknięcie okna chowa je do zasobnika — inaczej skrót globalny nie miałby do czego wracać.
  // Bez zasobnika (część pulpitów Linuksa) zamknięcie kończy aplikację jak dawniej.
  win.on('close', (e) => {
    if (quitting || !tray) return;
    e.preventDefault();
    void flushWindow(win).then(() => win.hide());
  });
  win.on('closed', () => {
    mainWin = null;
  });

  loadRenderer(win);
  return win;
}

function showMain(): void {
  if (!mainWin || mainWin.isDestroyed()) {
    mainWin = createMainWindow();
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function createQuickWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...QUICK_SIZE,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Prompt Pocket — szybkie szukanie',
    icon: ICON,
    webPreferences,
  });

  // Okno szybkie żyje tylko w chwili użycia: klik obok je chowa.
  win.on('blur', () => {
    if (!win.isDestroyed()) win.hide();
  });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    quickWin = null;
  });

  loadRenderer(win, 'quick');
  return win;
}

/** Pokazuje okno szybkiego szukania na ekranie, na którym jest kursor; drugi raz — chowa. */
function toggleQuick(): void {
  if (!quickWin || quickWin.isDestroyed()) quickWin = createQuickWindow();
  if (quickWin.isVisible()) {
    quickWin.hide();
    return;
  }
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  quickWin.setBounds({
    x: workArea.x + Math.round((workArea.width - QUICK_SIZE.width) / 2),
    y: workArea.y + Math.round(workArea.height * 0.18),
    ...QUICK_SIZE,
  });
  quickWin.show();
  quickWin.focus();
  quickWin.webContents.send('pocket:quickShown');
}

function createTray(): void {
  try {
    const size = process.platform === 'win32' ? 16 : 22;
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: size, height: size }));
  } catch {
    tray = null; // bez zasobnika zamknięcie okna po prostu kończy aplikację
    return;
  }
  tray.setToolTip('Prompt Pocket');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Otwórz Prompt Pocket', click: showMain },
      { label: `Szybkie szukanie (${SHORTCUT_LABEL})`, click: toggleQuick },
      { type: 'separator' },
      { label: 'Zakończ', click: () => app.quit() },
    ])
  );
  tray.on('click', showMain);
}

/* ---------- kopia zapasowa ---------- */

const backupConfigPath = () => path.join(app.getPath('userData'), 'backup.json');
/** Błąd ostatniej kopii automatycznej — trzymany w pamięci, żeby interfejs mógł go pokazać. */
let lastBackupError: string | null = null;

async function backupState(): Promise<BackupState> {
  const config = await backup.readConfig(backupConfigPath());
  return { ...config, synced: config.dir ? backup.isSyncedFolder(config.dir) : false, lastError: lastBackupError };
}

async function runBackup(): Promise<string> {
  const config = await backup.readConfig(backupConfigPath());
  if (!config.dir) throw new Error('Najpierw wskaż folder na kopie.');
  try {
    const result = await backup.backupNow(store.getRoot(), config.dir);
    await backup.writeConfig(backupConfigPath(), { ...config, lastAt: new Date().toISOString() });
    lastBackupError = null;
    return result.path;
  } catch (err) {
    lastBackupError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

/** Sprawdzane przy starcie i co godzinę — aplikacja potrafi siedzieć w zasobniku tygodniami. */
async function autoBackupIfDue(): Promise<void> {
  try {
    if (backup.isDue(await backup.readConfig(backupConfigPath()))) await runBackup();
  } catch {
    /* błąd jest w lastBackupError i widać go w ustawieniach */
  }
}

/* ---------- start ---------- */

// Druga kopia aplikacji (np. ponowne kliknięcie skrótu na pulpicie) tylko pokazuje pierwszą —
// dwie kopie biłyby się o skrót globalny i pisałyby do tych samych plików.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showMain);
}

/** Przed wyjściem okno musi zapisać zaległe zmiany — czekamy na nie, potem wychodzimy naprawdę. */
let flushedForQuit = false;
app.on('before-quit', (e) => {
  quitting = true;
  if (flushedForQuit) return;
  e.preventDefault();
  flushedForQuit = true;
  void flushWindow(mainWin).finally(() => app.quit());
});

app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(async () => {
  if (!gotLock) return;

  store.setRoot(resolveRoot());
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
  ipcMain.handle('catalog:saveVersionNote', (_e, relPath: string, note: string) =>
    store.saveVersionNote(relPath, note)
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

  /* ---------- schowek, skrót, kopia zapasowa ---------- */

  /** Schowek przez proces główny: okno szybkiego szukania chowa się zaraz po kopiowaniu. */
  ipcMain.handle('pocket:copyAndMarkUsed', async (_e, relPath: string, text: string) => {
    clipboard.writeText(text);
    await store.markUsed(relPath);
  });
  ipcMain.handle('pocket:getShortcut', () => ({ label: SHORTCUT_LABEL, registered: shortcutRegistered }));
  ipcMain.handle('pocket:hideQuick', () => quickWin?.hide());

  ipcMain.handle('pocket:getBackup', () => backupState());
  ipcMain.handle('pocket:chooseBackupDir', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(window ?? undefined!, {
      title: 'Folder na kopie zapasowe',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return null;
    const dir = filePaths[0];
    const rel = path.relative(path.resolve(store.getRoot()), path.resolve(dir));
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      throw new Error('Folder kopii nie może leżeć wewnątrz katalogu promptów.');
    }
    const config = await backup.readConfig(backupConfigPath());
    await backup.writeConfig(backupConfigPath(), { ...config, dir });
    return backupState();
  });
  ipcMain.handle('pocket:setBackupAuto', async (_e, auto: boolean) => {
    const config = await backup.readConfig(backupConfigPath());
    await backup.writeConfig(backupConfigPath(), { ...config, auto });
    void autoBackupIfDue();
    return backupState();
  });
  ipcMain.handle('pocket:backupNow', () => runBackup());

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

  createTray();
  mainWin = createMainWindow();
  // Okno szybkie tworzone od razu, ukryte — skrót ma działać natychmiast, bez ładowania strony.
  quickWin = createQuickWindow();
  // Rejestracja może się nie udać, gdy inny program zajął skrót — interfejs to pokazuje.
  shortcutRegistered = globalShortcut.register(SHORTCUT, toggleQuick);

  void autoBackupIfDue();
  setInterval(() => void autoBackupIfDue(), 60 * 60 * 1000);

  app.on('activate', showMain);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
