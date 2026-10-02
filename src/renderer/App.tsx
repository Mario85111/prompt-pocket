import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BackupState, PromptFamily, PromptVersion, SearchHit, ShortcutState } from '../shared/types';
import { diffLines } from '../shared/diff';
import { fillVars, findVars } from '../shared/vars';
import Creator from './Creator';
import { errorText, whenUsed } from './format';
import Help from './Help';
import VarsForm from './VarsForm';
import logo from '../../build/icon.svg';

const AUTOSAVE_MS = 2000;

/** Skórki. Wygląd zmienia jeden atrybut na <html>; reszta arkusza o motywach nie wie. */
const SKORKI = [
  { id: 'brutal', nazwa: 'Neo-brutal' },
  { id: 'matrix', nazwa: 'Matrix' },
  { id: 'apple', nazwa: 'Apple' },
  { id: 'pony', nazwa: 'Pony' },
  { id: 'nord', nazwa: 'Nord' },
  { id: 'speed', nazwa: 'Speed Night' },
  { id: 'denim', nazwa: 'Dżins' },
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
  const [view, setView] = useState<'katalog' | 'kreator' | 'pomoc'>('katalog');
  const [skorka, setSkorka] = useState(wczytajSkorke);
  const [menu, setMenu] = useState<'nowa' | 'ustawienia' | null>(null);
  /** W którą stronę rośnie okienko: zależy od tego, gdzie stoi przycisk po zawinięciu paska. */
  const [menuSide, setMenuSide] = useState<'left' | 'right'>('right');
  const barRef = useRef<HTMLElement | null>(null);
  const [note, setNote] = useState('');
  /** Z którą wersją porównujemy otwartą; null = zwykła edycja. */
  const [compareWith, setCompareWith] = useState<string | null>(null);
  /** Otwarty formularz zmiennych przed kopiowaniem. */
  const [asking, setAsking] = useState(false);
  const [shortcut, setShortcut] = useState<ShortcutState | null>(null);
  const [backupSt, setBackupSt] = useState<BackupState | null>(null);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  const timer = useRef<number | null>(null);
  const pending = useRef<{ relPath: string; body: string } | null>(null);
  const pendingNote = useRef<{ relPath: string; note: string } | null>(null);

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

  /** Zapisuje zaległą treść i notatkę. Ten sam autozapis obsługuje oba pola. */
  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    const n = pendingNote.current;
    if (!p && !n) return;
    pending.current = null;
    pendingNote.current = null;
    if (p) await window.catalog.saveVersionBody(p.relPath, p.body);
    if (n) await window.catalog.saveVersionNote(n.relPath, n.note);
    setSavedAt(new Date().toLocaleTimeString('pl-PL'));
    setDirty(false);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    const onBlur = () => void flush();
    // Powrót do okna (np. po kopiowaniu w szybkim szukaniu) odświeża listę i daty użycia.
    const onFocus = () => void refresh();
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onBlur);
    window.addEventListener('focus', onFocus);
    // Proces główny woła to przed schowaniem okna do zasobnika i przed wyjściem — i czeka.
    window.__ppFlush = flush;
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('beforeunload', onBlur);
      window.removeEventListener('focus', onFocus);
      delete window.__ppFlush;
    };
  }, [flush, refresh]);

  function scheduleSave() {
    setDirty(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  function onBodyChange(value: string) {
    setBody(value);
    if (!selected) return;
    pending.current = { relPath: selected.relPath, body: value };
    scheduleSave();
  }

  function onNoteChange(value: string) {
    setNote(value);
    if (!selected) return;
    pendingNote.current = { relPath: selected.relPath, note: value };
    scheduleSave();
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
      setNote(v.note);
      setCompareWith(null);
      setAsking(false);
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
    setMenu(null);
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

  /** Kopiowanie zapamiętuje datę użycia wersji — po niej lista układa się od najświeższych. */
  async function copyText(text: string) {
    if (!selected) return;
    await window.pocket.copyAndMarkUsed(selected.relPath, text);
    setAsking(false);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
    await refresh();
  }

  /** Prompt ze zmiennymi {{…}} najpierw pyta o wartości. */
  async function copyToClipboard() {
    if (!selected) return;
    await flush();
    if (findVars(body).length > 0) setAsking(true);
    else await copyText(body);
  }

  /* ---------- kopia zapasowa ---------- */

  async function chooseBackupDir() {
    setBackupMsg(null);
    try {
      const st = await window.pocket.chooseBackupDir();
      if (st) setBackupSt(st);
    } catch (err) {
      setBackupMsg(errorText(err));
    }
  }

  async function backupNow() {
    setBackupMsg('Robię kopię…');
    try {
      const where = await window.pocket.backupNow();
      setBackupMsg(`Gotowe: ${where}`);
    } catch (err) {
      setBackupMsg(`Nie wyszło: ${errorText(err)}`);
    }
    setBackupSt(await window.pocket.getBackup());
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

  /* Ustawienia czytają stan skrótu i kopii przy każdym otwarciu — mogły się zmienić w tle. */
  useEffect(() => {
    if (menu !== 'ustawienia') return;
    setBackupMsg(null);
    void window.pocket.getShortcut().then(setShortcut);
    void window.pocket.getBackup().then(setBackupSt);
  }, [menu]);

  /* ---------- porównanie i zmienne otwartej wersji ---------- */

  const family = useMemo(
    () => (selected ? families.find((f) => selected.relPath.startsWith(`${f.slug}/`)) ?? null : null),
    [families, selected]
  );
  const others = useMemo(
    () => (family && selected ? family.versions.filter((v) => v.relPath !== selected.relPath) : []),
    [family, selected]
  );
  const compared = others.find((v) => v.relPath === compareWith) ?? null;
  const diff = useMemo(() => (compared ? diffLines(compared.body, body) : []), [compared, body]);
  const vars = useMemo(() => findVars(body), [body]);

  /** Domyślnie porównujemy z rodzicem — to pokazuje, co zmieniło się w tej wersji. */
  function startCompare() {
    if (!selected || others.length === 0) return;
    const parent = others.find((v) => v.id === selected.parentVersionId);
    setCompareWith((parent ?? others[others.length - 1]).relPath);
  }

  /**
   * Przycisk w prawej połowie okna otwiera okienko w lewo, w lewej — w prawo.
   * Stałe wyrównanie nie wystarcza: przy wąskim oknie pasek się zawija i przyciski
   * przechodzą do lewej krawędzi.
   */
  function toggleMenu(which: 'nowa' | 'ustawienia', button: HTMLElement) {
    if (menu === which) {
      setMenu(null);
      return;
    }
    const r = button.getBoundingClientRect();
    setMenuSide(r.left + r.width / 2 > window.innerWidth / 2 ? 'right' : 'left');
    setMenu(which);
  }

  /* Menu rozwijane zamyka kliknięcie poza paskiem i Escape. */
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const stats = useMemo(() => {
    const versions = families.flatMap((f) => f.versions);
    return {
      families: families.length,
      versions: versions.length,
      multiVersion: families.filter((f) => f.versions.length > 1).length,
    };
  }, [families]);

  return (
    <div className="pocket">
      <div className="pocket-face">
        <div className="pocket-fabric" />
        <span className="pocket-rivet l" />
        <span className="pocket-rivet r" />
    <div className="app">
      <header className="topbar" ref={barRef}>
        {/* Znak, nie przycisk: bez ramki i cienia, żeby nie udawał czegoś do kliknięcia. */}
        <div className="brand">
          <img src={logo} alt="" width={30} height={30} />
          <h1>Prompt Pocket</h1>
        </div>

        <div className="tabs">
          <button className={view === 'katalog' ? 'tab active' : 'tab'} onClick={() => setView('katalog')}>
            Katalog
          </button>
          <button className={view === 'kreator' ? 'tab active' : 'tab'} onClick={() => setView('kreator')}>
            Kreator
          </button>
          <button className={view === 'pomoc' ? 'tab active' : 'tab'} onClick={() => setView('pomoc')}>
            Pomoc
          </button>
        </div>

        {/* Szukanie przeszukuje to, co jest — stąd tylko w katalogu, zrośnięte z listą trafień. */}
        {view === 'katalog' ? (
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
        ) : (
          <div className="grow" />
        )}

        <div className="menu-host">
          <button
            className={menu === 'nowa' ? 'menu-btn open' : 'menu-btn'}
            onClick={(e) => toggleMenu('nowa', e.currentTarget)}
          >
            + Dodaj
          </button>
          {menu === 'nowa' && (
            <div className={`popover ${menuSide}`}>
              <span className="tag wide">Nowa rodzina</span>
              <input
                autoFocus
                value={newTitle}
                placeholder="np. Audyt UX"
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createFamily();
                }}
              />
              <button onClick={() => void createFamily()} disabled={!newTitle.trim()}>
                Załóż
              </button>
              <div className="popover-sep" />
              <button
                className="ghost"
                onClick={() => {
                  setMenu(null);
                  void importFiles();
                }}
              >
                Importuj pliki .md
              </button>
              <p className="hint">Każdy plik zakłada osobną rodzinę; nazwa pliku staje się jej nazwą.</p>
            </div>
          )}
        </div>

        <div className="menu-host">
          <button
            className={menu === 'ustawienia' ? 'menu-btn open' : 'menu-btn'}
            onClick={(e) => toggleMenu('ustawienia', e.currentTarget)}
          >
            Ustawienia ▾
          </button>
          {menu === 'ustawienia' && (
            <div className={`popover ${menuSide} settings`}>
              <section className="settings-block">
                <span className="tag wide">Szybkie szukanie</span>
                <p className="hint">
                  {!shortcut
                    ? '…'
                    : shortcut.registered
                      ? <>Z dowolnego programu: <kbd>{shortcut.label}</kbd> — fraza, Enter i prompt jest w schowku. Zamknięcie okna chowa aplikację do zasobnika, żeby skrót działał dalej.</>
                      : `Skrót ${shortcut.label} zajął już inny program. Szybkie szukanie otworzysz z ikony w zasobniku.`}
                </p>
              </section>

              <section className="settings-block">
                <span className="tag wide">Kopia zapasowa</span>
                {backupSt?.dir ? <code title={backupSt.dir}>{backupSt.dir}</code> : <p className="hint">Folder na kopie nie jest wybrany.</p>}
                {backupSt?.synced && (
                  <p className="hint warn">Ten folder synchronizuje się z chmurą — kopie wyjdą poza ten komputer.</p>
                )}
                <div className="settings-row">
                  <button onClick={() => void chooseBackupDir()}>{backupSt?.dir ? 'Zmień folder' : 'Wybierz folder'}</button>
                  <button onClick={() => void backupNow()} disabled={!backupSt?.dir}>
                    Zrób kopię teraz
                  </button>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={backupSt?.auto ?? false}
                    disabled={!backupSt?.dir}
                    onChange={(e) => void window.pocket.setBackupAuto(e.target.checked).then(setBackupSt)}
                  />
                  Codziennie automatycznie (zostaje 10 ostatnich)
                </label>
                <p className="hint">
                  {backupMsg ??
                    (backupSt?.lastAt
                      ? `Ostatnia kopia: ${new Date(backupSt.lastAt).toLocaleString('pl-PL')}`
                      : 'Jeszcze nie było kopii.')}
                </p>
                {backupSt?.lastError && !backupMsg && (
                  <p className="hint bad">Ostatnia kopia nie wyszła: {backupSt.lastError}</p>
                )}
              </section>

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
            </div>
          )}
        </div>
      </header>

      <div className={view === 'katalog' ? 'workspace' : 'workspace solo'}>
        {view === 'katalog' && (
          <aside className="sidebar">
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
                  <span>
                    {f.title}
                    {f.lastUsedAt && <span className="used">{whenUsed(f.lastUsedAt)}</span>}
                  </span>
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
                    title={v.note || undefined}
                    onClick={() => void openVersion(v)}
                  >
                    <span>v{v.versionNo}</span>
                    {v.note && <span className="version-note">{v.note.split(/\r?\n/)[0]}</span>}
                    {v.working && <span className="badge">działa</span>}
                  </button>
                ))}
              </div>
            ))}
        </nav>
            <p className="sidebar-stats muted">
              {stats.families} rodzin · {stats.versions} wersji · {stats.multiVersion} wielowersyjnych
            </p>
          </aside>
        )}

      <main className="editor">
        {view === 'kreator' && (
          <Creator
            families={families}
            onSaved={async () => {
              await refresh();
            }}
          />
        )}

        {view === 'pomoc' && <Help root={root} onGoToCatalog={() => setView('katalog')} />}

        {view === 'katalog' && !selected && (
          <div className="placeholder">
            {families.length === 0 ? (
              <div className="first-run">
                <p>Katalog jest pusty. Kliknij <b>+ Dodaj</b>, żeby założyć pierwszą rodzinę.</p>
                <p>
                  Pierwszy raz tutaj?{' '}
                  <button className="link" onClick={() => setView('pomoc')}>
                    Zobacz, jak to działa
                  </button>
                </p>
              </div>
            ) : (
              <p>Wybierz wersję promptu z listy albo załóż nową rodzinę.</p>
            )}
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
              <button
                className={compared ? 'ghost on' : 'ghost'}
                onClick={() => (compared ? setCompareWith(null) : startCompare())}
                disabled={others.length === 0}
                title={others.length === 0 ? 'W rodzinie jest tylko ta wersja' : 'Pokaż różnice względem innej wersji'}
              >
                {compared ? 'Wróć do edycji' : 'Porównaj'}
              </button>
              <button className="ghost" onClick={() => void window.catalog.exportVersion(selected.relPath)}>
                Eksportuj .md
              </button>
              <button className="ghost" onClick={() => void removeSelected()}>
                Usuń tę wersję
              </button>
            </div>

            {asking && (
              <VarsForm
                vars={vars}
                onSubmit={(values) => void copyText(fillVars(body, values))}
                onRaw={() => void copyText(body)}
                onCancel={() => setAsking(false)}
              />
            )}

            <label className="note-row">
              <span className="tag">Notatka</span>
              <input
                value={note}
                placeholder="Co zmieniłem w tej wersji i dlaczego…"
                onChange={(e) => onNoteChange(e.target.value)}
                onBlur={() => void flush()}
              />
            </label>

            {compared ? (
              <div className="diff">
                <div className="diff-head">
                  <span>Porównanie z</span>
                  <select value={compared.relPath} onChange={(e) => setCompareWith(e.target.value)}>
                    {others.map((v) => (
                      <option key={v.relPath} value={v.relPath}>
                        v{v.versionNo}
                        {v.working ? ' (działa)' : ''}
                        {v.id === selected.parentVersionId ? ' — rodzic' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="diff-legend">
                    <span className="del">− tylko w v{compared.versionNo}</span>
                    <span className="add">+ tylko w v{selected.versionNo}</span>
                  </span>
                </div>
                {compared.note && <p className="hint">Notatka v{compared.versionNo}: {compared.note}</p>}
                <pre className="diff-body">
                  {diff.every((l) => l.kind === 'same') ? (
                    <span className="muted">Treść obu wersji jest identyczna.</span>
                  ) : (
                    diff.map((l, i) => (
                      <span key={i} className={`diff-line ${l.kind}`}>
                        {l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : '  '}
                        {l.text || ' '}
                        {'\n'}
                      </span>
                    ))
                  )}
                </pre>
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => onBodyChange(e.target.value)}
                onBlur={() => void flush()}
                spellCheck={false}
                placeholder="Treść promptu. Zapisuje się sama — nie ma przycisku „Zapisz”. Zmienne zapisz jako {{nazwa}}."
              />
            )}

            <p className="hint bottom">
              {vars.length > 0 ? (
                <>
                  Zmienne: {vars.map((v) => <code key={v} className="var-chip">{`{{${v}}}`}</code>)} — przy kopiowaniu
                  zapytam o wartości.
                </>
              ) : (
                <>Wpisz {'{{nazwa}}'} w treści, a przy kopiowaniu zapytam o wartość. Nowa wersja ląduje w podkatalogu tej, z której powstała.</>
              )}
            </p>
          </>
        )}
      </main>
      </div>
    </div>
      </div>
    </div>
  );
}
