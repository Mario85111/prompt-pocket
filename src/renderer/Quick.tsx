import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PromptFamily, PromptVersion, SearchHit } from '../shared/types';
import { fillVars, findVars } from '../shared/vars';
import { errorText, whenUsed } from './format';
import VarsForm from './VarsForm';

/**
 * Szybkie szukanie — małe okno wywoływane globalnym skrótem z dowolnego programu.
 * Cel jeden: od „potrzebuję tamtego promptu" do treści w schowku w kilka sekund.
 */

const SKORKA_KLUCZ = 'katalog.skorka';
const SEARCH_DEBOUNCE_MS = 120;
const MAX_ITEMS = 8;

interface Item {
  familyTitle: string;
  version: PromptVersion;
  excerpt: string;
  used: string;
}

/** Z rodziny bierzemy wersję działającą, a gdy żadna nie jest oznaczona — najnowszą (SCOPE M-3). */
function preferred(f: PromptFamily): PromptVersion | undefined {
  return f.versions.find((v) => v.working) ?? [...f.versions].sort((a, b) => b.versionNo - a.versionNo)[0];
}

function firstLine(body: string): string {
  return body.trim().split(/\r?\n/)[0]?.slice(0, 110) ?? '';
}

function applyTheme() {
  try {
    document.documentElement.dataset.theme = localStorage.getItem(SKORKA_KLUCZ) || 'brutal';
  } catch {
    document.documentElement.dataset.theme = 'brutal';
  }
}

export default function Quick() {
  const [families, setFamilies] = useState<PromptFamily[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [active, setActive] = useState(0);
  const [asking, setAsking] = useState<Item | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const reset = useCallback(async () => {
    applyTheme();
    setQuery('');
    setHits(null);
    setActive(0);
    setAsking(null);
    setStatus(null);
    setFamilies(await window.catalog.listFamilies());
    window.setTimeout(() => input.current?.focus(), 0);
  }, []);

  useEffect(() => {
    void reset();
    return window.pocket.onQuickShown(() => void reset());
  }, [reset]);

  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    const id = window.setTimeout(() => {
      void window.catalog.search(query).then((h) => {
        setHits(h);
        setActive(0);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  const items: Item[] = useMemo(() => {
    if (hits === null) {
      return families
        .map((f) => {
          const v = preferred(f);
          return v ? { familyTitle: f.title, version: v, excerpt: firstLine(v.body), used: whenUsed(f.lastUsedAt) } : null;
        })
        .filter((x): x is Item => x !== null)
        .slice(0, MAX_ITEMS);
    }
    // Jedna pozycja na rodzinę: wersja działająca, jeśli jest wśród trafień, inaczej najnowsze trafienie.
    const byFamily = new Map<string, SearchHit>();
    for (const h of hits) {
      const prev = byFamily.get(h.familySlug);
      if (!prev || (!prev.version.working && (h.version.working || h.version.versionNo > prev.version.versionNo))) {
        byFamily.set(h.familySlug, h);
      }
    }
    return [...byFamily.values()].slice(0, MAX_ITEMS).map((h) => ({
      familyTitle: h.familyTitle,
      version: h.version,
      excerpt: h.excerpt || firstLine(h.version.body),
      used: whenUsed(h.version.lastUsedAt),
    }));
  }, [families, hits]);

  async function copy(item: Item, text: string) {
    try {
      await window.pocket.copyAndMarkUsed(item.version.relPath, text);
      setStatus(`Skopiowano: ${item.familyTitle} · v${item.version.versionNo}`);
      window.setTimeout(() => void window.pocket.hideQuick(), 450);
    } catch (err) {
      setStatus(errorText(err));
    }
  }

  function choose(item: Item | undefined) {
    if (!item) return;
    if (findVars(item.version.body).length > 0) setAsking(item);
    else void copy(item, item.version.body);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      void window.pocket.hideQuick();
    }
  }

  return (
    <div className="quick">
      {asking ? (
        <div className="quick-vars">
          <p className="quick-title">
            {asking.familyTitle} · v{asking.version.versionNo}
          </p>
          <VarsForm
            vars={findVars(asking.version.body)}
            onSubmit={(values) => void copy(asking, fillVars(asking.version.body, values))}
            onRaw={() => void copy(asking, asking.version.body)}
            onCancel={() => {
              setAsking(null);
              window.setTimeout(() => input.current?.focus(), 0);
            }}
          />
          {status && <p className="quick-status">{status}</p>}
        </div>
      ) : (
        <>
          <div className="search-row quick-search">
            <span className="tag">Szukaj</span>
            <input
              ref={input}
              className="search"
              value={query}
              placeholder="fraza z treści albo nazwa rodziny…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>

          <ul className="quick-list" role="listbox" aria-label="Prompty">
            {items.map((it, i) => (
              <li
                key={it.version.relPath}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'quick-item active' : 'quick-item'}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(it);
                }}
              >
                <span className="quick-head">
                  <strong>{it.familyTitle}</strong>
                  <span className="muted">
                    v{it.version.versionNo}
                    {it.version.working ? ' · działa' : ''}
                    {it.used ? ` · ${it.used}` : ''}
                  </span>
                </span>
                {it.excerpt && <span className="quick-excerpt">{it.excerpt}</span>}
              </li>
            ))}
            {items.length === 0 && (
              <li className="quick-empty muted">
                {hits === null ? 'Katalog jest pusty — załóż rodzinę w głównym oknie.' : 'Brak trafień.'}
              </li>
            )}
          </ul>

          <p className="quick-hint">
            {status ?? '↑↓ wybierz · Enter kopiuje do schowka · Esc zamyka'}
          </p>
        </>
      )}
    </div>
  );
}
