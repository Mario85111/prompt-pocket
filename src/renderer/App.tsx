import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PromptFamily, PromptVersion, SearchHit } from '../shared/types';
import Creator from './Creator';

const AUTOSAVE_MS = 2000;

/** Skórki. Wygląd zmienia jeden atrybut na <html>; reszta arkusza o motywach nie wie. */
const SKORKI = [
  { id: 'brutal', nazwa: 'Neo-brutal' },
  { id: 'matrix', nazwa: 'Matrix' },
  { id: 'garden', nazwa: 'Garden' },
  { id: 'apple', nazwa: 'Apple' },
  { id: 'pony', nazwa: 'Pony' },
  { id: 'nord', nazwa: 'Nord' },
  { id: 'speed', nazwa: 'Speed Night' },
] as const;

const SKORKA_KLUCZ = 'katalog.skorka';

function wczytajSkorke(): string {
  // Wybór skórki to wygoda, nie dane — gdy magazyn przeglądarki zawiedzie, wracamy do domyślnej.
  try {
    const zapisana = localStorage.getItem(SKORKA_KLUCZ);
    if (zapisana && SKORKI.some((s) => s.id === zapisana)) return zapisana;
  } catch {
    /* prywatne okno albo zablokowany magazyn */
  }
  return 'brutal';
}
const SEARCH_DEBOUNCE_MS = 150;

/** Głębokość w drzewie wersji wynika ze ścieżki: v1.md = 0, v1/v2.md = 1, v1/v2/v3.md = 2. */
function depthOf(relPath: string): number {
  return relPath.split('/').length - 2;
}

export default function App() {
  const [root, setRoot] = useState('');
  const [families, setFamilies] = useState<PromptFamily[]>([]);
  const [selected, setSelected] = useState<PromptVersion | null>(null);
  const [body, setBody] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<'katalog' | 'kreator'>('katalog');
  const [skorka, setSkorka] = useState(wczytajSkorke);

  const timer = useRef<number | null>(null);
  const pending = useRef<{ relPath: string; body: string } | null>(null);

  const refresh = useCallback(async () => {
    const list = await window.catalog.listFamilies();
    setFamilies(list);
    return list;
  }, []);

  useEffect(() => {
    void (async () => {
      setRoot(await window.catalog.getRoot());
      await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    document.documentElement.dataset.theme = skorka;
    try {
      localStorage.setItem(SKORKA_KLUCZ, skorka);
    } catch {
      /* brak magazynu nie może wywrócić aplikacji */
    }
  }, [skorka]);

  /* ---------- autozapis (M-2) ---------- */

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    await window.catalog.saveVersionBody(p.relPath, p.body);
    setSavedAt(new Date().toLocaleTimeString('pl-PL'));
    setDirty(false);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    const onBlur = () => void flush();
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('beforeunload', onBlur);
    };
  }, [flush]);

  function onBodyChange(value: string) {
    setBody(value);
    if (!selected) return;
    setDirty(true);
    pending.current = { relPath: selected.relPath, body: value };
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  /* ---------- wyszukiwanie (M-4) ---------- */

  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    const id = window.setTimeout(() => {
      void window.catalog.search(query).then(setHits);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query, families]);

  /* ---------- akcje ---------- */

  const openVersion = useCallback(
    async (v: PromptVersion) => {
      await flush();
      setSelected(v);
      setBody(v.body);
      setSavedAt(null);
      setDirty(false);
      setCopied(false);
    },
    [flush]
  );

  async function createFamily() {
    const title = newTitle.trim();
    if (!title) return;
    await flush();
    const family = await window.catalog.createFamily(title);
    setNewTitle('');
    await refresh();
    if (family.versions[0]) await openVersion(family.versions[0]);
  }

  async function branchFromSelected() {
    if (!selected) return;
    await flush();
    const child = await window.catalog.createVersionFrom(selected.relPath);
    await refresh();
    await openVersion(child);
  }

  async function markWorking() {
    if (!selected) return;
    await window.catalog.setWorkingVersion(selected.relPath);
    const list = await refresh();
    const fresh = list
      .flatMap((f) => f.versions)
      .find((v) => v.relPath === selected.relPath);
    if (fresh) setSelected(fresh);
  }

  async function copyToClipboard() {
    if (!selected) return;
    await flush();
    await navigator.clipboard.writeText(body);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  /** Wybór plików i zapis robi proces główny; tutaj zostaje odświeżenie listy. */
  async function importFiles() {
    const count = await window.catalog.importFiles();
    if (count === 0) return;
    await refresh();
  }

  /** Potwierdzenie pokazuje proces główny — stąd tylko prośba i sprzątanie widoku po fakcie. */
  async function removeSelected() {
    if (!selected) return;
    const done = await window.catalog.deleteVersion(selected.relPath);
    if (!done) return;
    setSelected(null);
    setBody('');
    await refresh();
  }

  async function removeFamily(slug: string, title: string) {
    const done = await window.catalog.deleteFamily(slug, title);
    if (!done) return;
    if (selected?.relPath.startsWith(`${slug}/`)) {
      setSelected(null);
      setBody('');
    }
    await refresh();
  }

  const stats = useMemo(() => {
    const versions = families.flatMap((f) => f.versions);
    return {
      families: families.length,
      versions: versions.length,
      multiVersion: families.filter((f) => f.versions.length > 1).length,
    };
  }, [families]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>Prompt Pocket</h1>
          <p className="muted">
            {stats.families} rodzin · {stats.versions} wersji ·{' '}
            {stats.multiVersion} wielowersyjnych
          </p>
        </div>

        <div className="tabs">
          <button className={view === 'katalog' ? 'tab active' : 'tab'} onClick={() => setView('katalog')}>
            Katalog
          </button>
          <button className={view === 'kreator' ? 'tab active' : 'tab'} onClick={() => setView('kreator')}>
            Kreator
          </button>
        </div>

        {/* Szukanie przeszukuje to, co jest — stąd zrośnięte z listą poniżej. */}
        <div className="search-row">
          <span className="tag">Szukaj</span>
          <input
            className="search"
            value={query}
            placeholder="w treści i tytułach…"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="clear" title="Wyczyść" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </div>

        {/* Zakładanie rodziny tworzy coś nowego — osobna kafla, nie kolejne pole w rzędzie. */}
        <div className="new-family">
          <div className="tag wide">Nowa rodzina</div>
          <div className="new-family-body">
            <input
              value={newTitle}
              placeholder="Nazwa, np. Audyt UX"
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createFamily();
              }}
            />
            <button onClick={() => void createFamily()} disabled={!newTitle.trim()}>
              Załóż
            </button>
            <button
              className="ghost"
              title="Wczytaj pliki .md — każdy zakłada osobną rodzinę"
              onClick={() => void importFiles()}
            >
              Importuj
            </button>
          </div>
        </div>

        <nav className="families">
          {hits !== null && (
            <>
              <p className="section">
                {hits.length === 0 ? 'Brak trafień' : `Trafienia: ${hits.length}`}
              </p>
              {hits.map((h) => (
                <button
                  key={h.version.relPath}
                  className={`hit${selected?.relPath === h.version.relPath ? ' active' : ''}`}
                  onClick={() => void openVersion(h.version)}
                >
                  <span className="hit-title">
                    {h.familyTitle} · v{h.version.versionNo}
                  </span>
                  {h.excerpt && <span className="hit-excerpt">{h.excerpt}</span>}
                </button>
              ))}
            </>
          )}

          {hits === null && families.length === 0 && (
            <p className="muted empty">Katalog jest pusty. Załóż pierwszą rodzinę.</p>
          )}

          {hits === null &&
            families.map((f) => (
              <div key={f.id} className="family">
                <div className="family-title">
                  <span>{f.title}</span>
                  <span className="family-actions">
                    <button
                      className="link"
                      title="Zapisz wszystkie wersje w jednym pliku .md"
                      onClick={() => void window.catalog.exportFamily(f.slug)}
                    >
                      eksport
                    </button>
                    <button
                      className="link del"
                      title="Przenieś całą rodzinę do kosza"
                      onClick={() => void removeFamily(f.slug, f.title)}
                    >
                      usuń
                    </button>
                  </span>
                </div>
                {f.versions.map((v) => (
                  <button
                    key={v.relPath}
                    className={`version${selected?.relPath === v.relPath ? ' active' : ''}`}
                    style={{ marginLeft: depthOf(v.relPath) * 12 }}
                    onClick={() => void openVersion(v)}
                  >
                    <span>v{v.versionNo}</span>
                    {v.working && <span className="badge">działa</span>}
                  </button>
                ))}
              </div>
            ))}
        </nav>

        <footer className="root">
          <div className="skins">
            <span className="tag">Skórka</span>
            <select value={skorka} onChange={(e) => setSkorka(e.target.value)}>
              {SKORKI.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nazwa}
                </option>
              ))}
            </select>
          </div>
          <button className="link" onClick={() => void window.catalog.revealRoot()}>
            Otwórz katalog na dysku
          </button>
          <code title={root}>{root}</code>
        </footer>
      </aside>

      <main className="editor">
        {view === 'kreator' && (
          <Creator
            families={families}
            onSaved={async () => {
              await refresh();
            }}
          />
        )}

        {view === 'katalog' && !selected && (
          <div className="placeholder">
            <p>Wybierz wersję promptu z listy albo załóż nową rodzinę.</p>
          </div>
        )}

        {view === 'katalog' && selected && (
          <>
            <header className="editor-head">
              <div className="path">
                <strong>{selected.relPath}</strong>
                <span className="muted">
                  {' '}
                  · wersja {selected.versionNo}
                </span>
              </div>
              <div className={`status${dirty ? ' dirty' : ''}`}>
                {dirty ? 'niezapisane zmiany…' : savedAt ? `zapisano ${savedAt}` : 'bez zmian'}
              </div>
            </header>

            <div className="actions">
              <button onClick={() => void copyToClipboard()}>
                {copied ? 'skopiowano ✓' : 'Kopiuj do schowka'}
              </button>
              <button onClick={() => void branchFromSelected()}>Nowa wersja z tej</button>
              <button onClick={() => void markWorking()} disabled={selected.working}>
                {selected.working ? 'To jest wersja działająca' : 'Oznacz jako działającą'}
              </button>
              <button className="ghost" onClick={() => void window.catalog.exportVersion(selected.relPath)}>
                Eksportuj .md
              </button>
              <button className="ghost" onClick={() => void removeSelected()}>
                Usuń tę wersję
              </button>
            </div>

            <textarea
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              onBlur={() => void flush()}
              spellCheck={false}
              placeholder="Treść promptu. Zapisuje się sama — nie ma przycisku „Zapisz”."
            />

            <p className="hint bottom">
              Nowa wersja ląduje w podkatalogu tej, z której powstała — struktura folderów pokazuje pochodzenie.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
