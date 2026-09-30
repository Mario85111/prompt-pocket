/**
 * Magazyn plikowy. Pliki .md na dysku są ŹRÓDŁEM PRAWDY — nic nie jest trzymane
 * wyłącznie w pamięci ani w bazie. Struktura na dysku (SCOPE §5):
 *
 *   PromptPocket/<slug-rodziny>/_rodzina.md      metadane rodziny
 *   PromptPocket/<slug-rodziny>/v1.md            wersja pierwsza
 *   PromptPocket/<slug-rodziny>/v1/v2.md         wersja wywiedziona z v1
 *
 * Wersja wywiedziona leży w PODKATALOGU wersji, z której powstała — tak,
 * żeby pochodzenie było widoczne w samym eksploratorze plików.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PromptFamily, PromptVersion } from '../shared/types';

const FAMILY_FILE = '_rodzina.md';

let rootDir = '';

export function setRoot(dir: string): void {
  rootDir = dir;
}

export function getRoot(): string {
  return rootDir;
}

export async function ensureRoot(): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true });
}

/* ---------- front-matter: minimalny, bez zależności ---------- */

type Meta = Record<string, string>;

function parseFile(raw: string): { meta: Meta; body: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: raw };

  const head = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  const meta: Meta = {};

  for (const line of head.split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    meta[key] = value;
  }
  return { meta, body };
}

function serializeFile(meta: Meta, body: string): string {
  const head = Object.entries(meta)
    .map(([k, v]) => `${k}: ${/[:#]|^\s|\s$/.test(v) ? JSON.stringify(v) : v}`)
    .join('\n');
  // Dokładnie jeden znak nowej linii po zamykającym ---, bo parser zdejmuje dokładnie jeden.
  // Symetria jest tu warunkiem bezstratności: inaczej każdy cykl zapis→odczyt dokłada pustą linię.
  return `---\n${head}\n---\n${body}`;
}

/* ---------- zapis atomowy ---------- */

/**
 * Zapis przez plik tymczasowy + zamianę. Ubicie procesu w trakcie zapisu
 * zostawia albo starą, albo nową treść — nigdy pliku obciętego w połowie.
 */
async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, filePath);
}

/* ---------- slug ---------- */

const PL: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z',
};

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (ch) => PL[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'prompt';
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  // Kolizja nazw rozstrzygana przyrostkiem — rodzina nigdy nie wchodzi w cudzy folder.
  while (await exists(path.join(rootDir, slug))) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/* ---------- odczyt ---------- */

/** Zbiera pliki wersji (vN.md) w folderze rodziny, schodząc w podkatalogi wersji. */
async function collectVersionFiles(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await collectVersionFiles(full, acc);
    } else if (e.isFile() && e.name.endsWith('.md') && e.name !== FAMILY_FILE) {
      acc.push(full);
    }
  }
  return acc;
}

async function readVersion(familyDir: string, filePath: string): Promise<PromptVersion> {
  const raw = await fs.readFile(filePath, 'utf8');
  const { meta, body } = parseFile(raw);
  const versionNo = Number(meta.versionNo) || 1;

  return {
    id: meta.id || path.relative(rootDir, filePath),
    familyId: meta.familyId || path.basename(familyDir),
    parentVersionId: meta.parentVersionId && meta.parentVersionId !== 'null' ? meta.parentVersionId : null,
    versionNo,
    createdAt: meta.createdAt || new Date(0).toISOString(),
    working: meta.working === 'true',
    relPath: path.relative(rootDir, filePath).split(path.sep).join('/'),
    body,
  };
}

/**
 * Indeks wyszukiwania trzymany w pamięci procesu głównego.
 * Jest w pełni odtwarzalny z plików — nigdy nie zawiera danych, których nie ma na dysku (SCOPE M-6).
 * Unieważniany przy każdym zapisie, odbudowywany przy pierwszym odczycie po zmianie.
 */
let cache: PromptFamily[] | null = null;

function invalidate(): void {
  cache = null;
}

export async function listFamilies(force = false): Promise<PromptFamily[]> {
  if (cache && !force) return cache;
  const families = await scanFromDisk();
  cache = families;
  return families;
}

async function scanFromDisk(): Promise<PromptFamily[]> {
  await ensureRoot();
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const families: PromptFamily[] = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const familyDir = path.join(rootDir, e.name);
    const familyFile = path.join(familyDir, FAMILY_FILE);
    if (!(await exists(familyFile))) continue;

    const { meta } = parseFile(await fs.readFile(familyFile, 'utf8'));
    const files = await collectVersionFiles(familyDir);
    const versions = await Promise.all(files.map((f) => readVersion(familyDir, f)));
    // Sortowanie po ścieżce odwzorowuje pochodzenie: v1.md, v1/v2.md, v1/v2/v3.md, v1/v4.md
    versions.sort((a, b) => a.relPath.localeCompare(b.relPath));

    families.push({
      id: meta.id || e.name,
      title: meta.title || e.name,
      slug: e.name,
      createdAt: meta.createdAt || new Date(0).toISOString(),
      versions,
    });
  }

  families.sort((a, b) => a.title.localeCompare(b.title, 'pl'));
  return families;
}

/* ---------- zapis ---------- */

/** Rodzinę zakłada wyłącznie autor, podając tytuł. Aplikacja nigdy nie zgaduje przynależności (SCOPE M-1). */
export async function createFamily(title: string): Promise<PromptFamily> {
  await ensureRoot();
  const clean = title.trim() || 'Bez tytułu';
  const slug = await uniqueSlug(slugify(clean));
  const familyDir = path.join(rootDir, slug);
  const now = new Date().toISOString();
  const familyId = randomUUID();

  await writeAtomic(
    path.join(familyDir, FAMILY_FILE),
    serializeFile({ id: familyId, title: clean, createdAt: now }, `# ${clean}\n`)
  );

  const versionId = randomUUID();
  await writeAtomic(
    path.join(familyDir, 'v1.md'),
    serializeFile(
      {
        id: versionId,
        familyId,
        parentVersionId: 'null',
        versionNo: '1',
        createdAt: now,
        working: 'false',
      },
      ''
    )
  );

  invalidate();
  const files = await collectVersionFiles(familyDir);
  const versions = await Promise.all(files.map((f) => readVersion(familyDir, f)));

  return { id: familyId, title: clean, slug, createdAt: now, versions };
}

/* ---------- M-1: nowa wersja wywiedziona z istniejącej ---------- */

function safeResolve(relPath: string): string {
  const resolved = path.resolve(path.join(rootDir, relPath));
  if (!resolved.startsWith(path.resolve(rootDir) + path.sep)) {
    throw new Error('Ścieżka poza katalogiem promptów.');
  }
  return resolved;
}

/**
 * Tworzy wersję potomną: plik ląduje w PODKATALOGU wersji rodzica
 * (v1.md → v1/v2.md), a rodzic zostaje nietknięty.
 * Numer wersji jest kolejnym wolnym numerem w całej rodzinie — nie w gałęzi —
 * żeby „v3" znaczyło jedno i to samo niezależnie od tego, gdzie leży w drzewie.
 */
export async function createVersionFrom(parentRelPath: string): Promise<PromptVersion> {
  const parentFile = safeResolve(parentRelPath);
  const raw = await fs.readFile(parentFile, 'utf8');
  const { meta: parentMeta, body } = parseFile(raw);

  const familySlug = parentRelPath.split('/')[0];
  const familyDir = path.join(rootDir, familySlug);

  const siblings = await collectVersionFiles(familyDir);
  const numbers = await Promise.all(
    siblings.map(async (f) => {
      const { meta } = parseFile(await fs.readFile(f, 'utf8'));
      return Number(meta.versionNo) || 0;
    })
  );
  const nextNo = Math.max(0, ...numbers) + 1;

  // v1.md → katalog v1/ ; v1/v2.md → katalog v1/v2/
  const childDir = parentFile.replace(/\.md$/, '');
  const childFile = path.join(childDir, `v${nextNo}.md`);

  await writeAtomic(
    childFile,
    serializeFile(
      {
        id: randomUUID(),
        familyId: parentMeta.familyId || familySlug,
        parentVersionId: parentMeta.id || 'null',
        versionNo: String(nextNo),
        createdAt: new Date().toISOString(),
        working: 'false',
      },
      body // nowa wersja startuje od treści rodzica — to jest sens „poprawiam dalej"
    )
  );

  invalidate();
  return readVersion(familyDir, childFile);
}

/* ---------- M-3: oznaczenie wersji działającej ---------- */

async function setWorkingFlag(filePath: string, working: boolean): Promise<void> {
  const raw = await fs.readFile(filePath, 'utf8');
  const { meta, body } = parseFile(raw);
  meta.working = String(working);
  await writeAtomic(filePath, serializeFile(meta, body));
}

/** W rodzinie działająca jest co najwyżej jedna wersja — oznaczenie nowej zdejmuje flagę z poprzedniej. */
export async function setWorkingVersion(relPath: string): Promise<void> {
  const target = safeResolve(relPath);
  const familySlug = relPath.split('/')[0];
  const familyDir = path.join(rootDir, familySlug);

  for (const file of await collectVersionFiles(familyDir)) {
    const shouldBeWorking = path.resolve(file) === target;
    const { meta } = parseFile(await fs.readFile(file, 'utf8'));
    if ((meta.working === 'true') !== shouldBeWorking) {
      await setWorkingFlag(file, shouldBeWorking);
    }
  }
  invalidate();
}

/* ---------- zapis wyniku pracy agentów (M2) ---------- */

/**
 * Dokłada wersję do istniejącej rodziny. Rodzicem jest wersja oznaczona jako działająca,
 * a gdy takiej nie ma — ostatnia. Rodzinę wybiera autor; aplikacja nadal jej nie zgaduje.
 */
export async function appendVersionToFamily(familySlug: string, body: string): Promise<PromptVersion> {
  const families = await listFamilies();
  const family = families.find((f) => f.slug === familySlug);
  if (!family || family.versions.length === 0) {
    throw new Error(`Nie znam rodziny „${familySlug}".`);
  }
  const parent = family.versions.find((v) => v.working) ?? family.versions[family.versions.length - 1];
  const child = await createVersionFrom(parent.relPath);
  await saveVersionBody(child.relPath, body);
  invalidate();
  return { ...child, body };
}

/** Zakłada rodzinę i od razu wypełnia v1 treścią. */
export async function createFamilyWithBody(title: string, body: string): Promise<PromptVersion> {
  const family = await createFamily(title);
  const v1 = family.versions[0];
  await saveVersionBody(v1.relPath, body);
  invalidate();
  return { ...v1, body };
}

/* ---------- import i eksport ---------- */

/**
 * Eksport oddaje samą treść promptu, bez nagłówka metadanych — to jest to, co się wkleja
 * gdzie indziej. Metadane zostają w katalogu; plik na zewnątrz ma być gotowy do użycia.
 */
export async function exportVersion(relPath: string): Promise<{ name: string; content: string }> {
  const families = await listFamilies();
  const slug = relPath.split('/')[0];
  const family = families.find((f) => f.slug === slug);
  const version = family?.versions.find((v) => v.relPath === relPath);
  if (!family || !version) throw new Error('Nie znam tej wersji.');

  return { name: `${family.slug}-v${version.versionNo}.md`, content: version.body };
}

/** Cała rodzina w jednym pliku: wersje po kolei, każda pod swoim nagłówkiem. */
export async function exportFamily(slug: string): Promise<{ name: string; content: string }> {
  const families = await listFamilies();
  const family = families.find((f) => f.slug === slug);
  if (!family) throw new Error(`Nie znam rodziny „${slug}".`);

  const parts = [`# ${family.title}`, ''];
  for (const v of family.versions) {
    parts.push(`## v${v.versionNo}${v.working ? ' (wersja działająca)' : ''}`, '', v.body.trim(), '');
  }
  return { name: `${family.slug}.md`, content: parts.join('\n') };
}

/**
 * Import: plik staje się nową rodziną z treścią w v1.
 * Nagłówek metadanych zdejmujemy, jeśli jest — dzięki temu plik wyjęty wprost z katalogu
 * wraca do niego czysty, bez podwójnego nagłówka.
 */
export async function importAsFamily(title: string, raw: string): Promise<PromptVersion> {
  const { body } = parseFile(raw);
  return createFamilyWithBody(title, body.trim());
}

/* ---------- usuwanie ---------- */

/**
 * Sposób usuwania jest wstrzykiwany, bo domyślny — kosz systemowy — należy do Electrona,
 * a ten moduł ma zostać testowalny bez uruchamiania całej aplikacji.
 */
export type Remover = (absPath: string) => Promise<void>;

let remove: Remover = async (absPath) => {
  await fs.rm(absPath, { recursive: true, force: true });
};

export function setRemover(fn: Remover): void {
  remove = fn;
}

export interface DeletionPlan {
  /** Wersje, które znikną: wskazana plus wszystkie z niej wywiedzione. */
  versions: string[];
  /** Czy razem z nimi znika cała rodzina. */
  wholeFamily: boolean;
  familyTitle: string;
}

/**
 * Co dokładnie zniknie przy usuwaniu wersji. Liczone przed pytaniem użytkownika,
 * żeby pytanie mówiło prawdę: wersje potomne leżą w podkatalogu rodzica i idą razem z nim.
 */
export async function planVersionDeletion(relPath: string): Promise<DeletionPlan> {
  const families = await listFamilies();
  const slug = relPath.split('/')[0];
  const family = families.find((f) => f.slug === slug);
  if (!family) throw new Error(`Nie znam rodziny „${slug}".`);

  const childPrefix = `${relPath.replace(/\.md$/, '')}/`;
  const doomed = family.versions.filter((v) => v.relPath === relPath || v.relPath.startsWith(childPrefix));

  return {
    versions: doomed.map((v) => `v${v.versionNo}`),
    wholeFamily: doomed.length === family.versions.length,
    familyTitle: family.title,
  };
}

/** Usuwa wersję wraz z wywiedzionymi z niej. Gdy to była ostatnia wersja, znika cała rodzina. */
export async function deleteVersion(relPath: string): Promise<void> {
  const file = safeResolve(relPath);
  const plan = await planVersionDeletion(relPath);

  if (plan.wholeFamily) {
    await deleteFamily(relPath.split('/')[0]);
    return;
  }

  const childDir = file.replace(/\.md$/, '');
  if (await exists(childDir)) await remove(childDir);
  await remove(file);
  invalidate();
}

/** Usuwa całą rodzinę razem z historią wersji. */
export async function deleteFamily(slug: string): Promise<void> {
  if (!slug || slug.includes('/') || slug.includes('\\') || slug === '..') {
    throw new Error('Niepoprawna nazwa rodziny.');
  }
  const dir = path.resolve(path.join(rootDir, slug));
  if (!dir.startsWith(path.resolve(rootDir) + path.sep)) {
    throw new Error('Ścieżka poza katalogiem promptów.');
  }
  if (!(await exists(dir))) throw new Error('Tej rodziny już nie ma.');
  await remove(dir);
  invalidate();
}

/* ---------- M-4: wyszukiwanie ---------- */

export interface SearchHit {
  familyTitle: string;
  familySlug: string;
  version: PromptVersion;
  /** Fragment treści wokół trafienia; pusty, gdy trafienie jest tylko w tytule rodziny. */
  excerpt: string;
}

export async function search(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const families = await listFamilies();
  const hits: SearchHit[] = [];

  for (const family of families) {
    const titleHit = family.title.toLowerCase().includes(q);
    for (const version of family.versions) {
      const at = version.body.toLowerCase().indexOf(q);
      if (at === -1 && !titleHit) continue;

      let excerpt = '';
      if (at !== -1) {
        const from = Math.max(0, at - 40);
        excerpt =
          (from > 0 ? '…' : '') +
          version.body.slice(from, at + q.length + 40).replace(/\s+/g, ' ').trim() +
          '…';
      }
      hits.push({ familyTitle: family.title, familySlug: family.slug, version, excerpt });
    }
  }
  return hits;
}

/**
 * Nadpisuje wyłącznie treść wersji, zachowując jej metadane.
 * Wywoływane autozapisem — w interfejsie nie ma przycisku „Zapisz" (SCOPE M-2).
 */
export async function saveVersionBody(relPath: string, body: string): Promise<void> {
  const resolved = safeResolve(relPath);
  const raw = await fs.readFile(resolved, 'utf8');
  const { meta } = parseFile(raw);
  await writeAtomic(resolved, serializeFile(meta, body));
  invalidate();
}
