/**
 * Kopia zapasowa katalogu promptów.
 *
 * Katalog celowo leży poza folderem synchronizowanym (SCOPE §7), więc bez kopii awaria dysku
 * zabiera wszystko. Kopia to zwykły folder z tymi samymi plikami .md — czytelny bez aplikacji,
 * przywracany zwykłym skopiowaniem z powrotem. Trzymamy ostatnie KEEP kopii, starsze znikają.
 *
 * Moduł nie zależy od Electrona: ścieżki dostaje z zewnątrz, więc testy działają na katalogu
 * tymczasowym.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface BackupConfig {
  /** Folder, do którego trafiają kopie. Null, dopóki autor go nie wskaże. */
  dir: string | null;
  /** Czy robić kopię automatycznie, raz na dobę. */
  auto: boolean;
  /** Kiedy powstała ostatnia kopia. */
  lastAt: string | null;
}

export const KEEP = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const PREFIX = 'PromptPocket-kopia-';
/** Nazwa kopii zaczyna się od daty, więc porządek alfabetyczny jest chronologiczny. */
const NAME = /^PromptPocket-kopia-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?$/;

const DEFAULT: BackupConfig = { dir: null, auto: false, lastAt: null };

export async function readConfig(configPath: string): Promise<BackupConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, 'utf8')) as Partial<BackupConfig>;
    return {
      dir: typeof parsed.dir === 'string' && parsed.dir ? parsed.dir : null,
      auto: parsed.auto === true,
      lastAt: typeof parsed.lastAt === 'string' ? parsed.lastAt : null,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export async function writeConfig(configPath: string, config: BackupConfig): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/** Kopia w folderze synchronizowanym wysłałaby prompty z maszyny — interfejs o tym ostrzega. */
export function isSyncedFolder(dir: string): boolean {
  return /[\\/](OneDrive|Dropbox|Google Drive|iCloudDrive)([\\/ -]|$)/i.test(dir);
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export interface BackupResult {
  /** Pełna ścieżka do utworzonej kopii. */
  path: string;
  /** Ile kopii zostało po sprzątaniu. */
  kept: number;
}

/**
 * Kopiuje cały katalog promptów do nowego folderu z datą w nazwie i sprząta kopie
 * ponad limit. Usuwa wyłącznie foldery o naszej nazwie — nic innego w folderze kopii nie rusza.
 */
export async function backupNow(rootDir: string, targetDir: string, now: Date = new Date()): Promise<BackupResult> {
  if (isInside(targetDir, rootDir)) {
    throw new Error('Folder kopii nie może leżeć wewnątrz katalogu promptów — kopia kopiowałaby samą siebie.');
  }
  await fs.mkdir(targetDir, { recursive: true });

  let dest = path.join(targetDir, PREFIX + stamp(now));
  for (let n = 2; await exists(dest); n++) dest = path.join(targetDir, `${PREFIX}${stamp(now)}-${n}`);

  await fs.cp(rootDir, dest, {
    recursive: true,
    // Pliki tymczasowe zapisu atomowego to nie dane — nie ma po co ich przenosić.
    filter: (src) => !/\.tmp-\d+$/.test(src),
  });

  const ours = (await fs.readdir(targetDir, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && NAME.test(e.name))
    .map((e) => e.name)
    .sort();
  for (const old of ours.slice(0, Math.max(0, ours.length - KEEP))) {
    await fs.rm(path.join(targetDir, old), { recursive: true, force: true });
  }

  return { path: dest, kept: Math.min(ours.length, KEEP) };
}

/** Czy pora na kopię automatyczną: włączona, folder wskazany i od ostatniej minęła doba. */
export function isDue(config: BackupConfig, now: Date = new Date()): boolean {
  if (!config.auto || !config.dir) return false;
  if (!config.lastAt) return true;
  const last = Date.parse(config.lastAt);
  return Number.isNaN(last) || now.getTime() - last >= DAY_MS;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
