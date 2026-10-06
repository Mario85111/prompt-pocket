import { useEffect, useState } from 'react';
import type {
  AuditResult,
  PromptFamily,
  ProviderConfig,
  ProviderInfo,
  QA,
  ServerCheck,
  WriterResult,
} from '../shared/types';
import { isInsecureRemote, isLocalHost, LOCAL_PRESETS, normalizeBaseUrl } from '../shared/endpoint';

interface Props {
  families: PromptFamily[];
  onSaved: () => Promise<void> | void;
}

type Stage = 'opis' | 'pytania' | 'wynik';

export default function Creator({ families, onSaved }: Props) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [task, setTask] = useState('');
  const [stage, setStage] = useState<Stage>('opis');
  const [answers, setAnswers] = useState<QA[]>([]);
  const [writer, setWriter] = useState<WriterResult | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [chars, setChars] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [newFamily, setNewFamily] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [serverCheck, setServerCheck] = useState<ServerCheck | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void (async () => {
      const cfg = await window.agents.getConfig();
      setConfig(cfg);
      setProviders(await window.agents.listProviders());
      if (cfg.mode !== 'cli') setHasKey(await window.agents.hasApiKey(cfg.mode));
      if (cfg.mode === 'custom') void checkServer(cfg.custom.baseUrl);
    })();
  }, []);

  /** Sprawdza serwer i przy okazji pobiera listę modeli do wybrania kliknięciem. */
  async function checkServer(baseUrl: string) {
    setChecking(true);
    try {
      setServerCheck(await window.agents.checkServer(baseUrl));
    } finally {
      setChecking(false);
    }
  }

  function setCustom(next: Partial<ProviderConfig['custom']>) {
    if (!config) return;
    if (next.baseUrl !== undefined) setServerCheck(null);
    void saveConfig({ ...config, custom: { ...config.custom, ...next } });
  }

  /* Licznik: praca trwa i tak dziesiątki sekund, więc liczy się każdy dowód, że coś się dzieje. */
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [busy]);

  /* Ile znaków model zdążył napisać. Droga przez Anthropic nie strumieniuje — tam zostaje sam czas. */
  useEffect(() => window.agents.onProgress((p) => setChars(p.chars)), []);

  /** Każdy dostawca ma własny klucz, więc po przełączeniu trybu pytamy o ten właściwy. */
  async function switchMode(mode: ProviderConfig['mode']) {
    if (!config) return;
    setKeyInput('');
    await saveConfig({ ...config, mode });
    setHasKey(mode === 'cli' ? null : await window.agents.hasApiKey(mode));
    if (mode === 'custom') void checkServer(config.custom.baseUrl);
  }

  async function saveKey() {
    if (!config || config.mode === 'cli') return;
    setError(null);
    try {
      await window.agents.setApiKey(config.mode, keyInput);
      setKeyInput('');
      setHasKey(await window.agents.hasApiKey(config.mode));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function dropKey() {
    if (!config || config.mode === 'cli') return;
    await window.agents.clearApiKey(config.mode);
    setHasKey(await window.agents.hasApiKey(config.mode));
  }

  async function saveConfig(next: ProviderConfig) {
    setError(null);
    setConfig(next);
    try {
      await window.agents.setConfig(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Anthropic: sam klucz (model jest stały). OpenAI, Gemini, OpenRouter: klucz i wskazany model.
   * CLI: tylko polecenie, bo logowanie ma już program, który autor uruchamia.
   */
  /** Opis aktywnego dostawcy konwencji OpenAI; null, gdy wybrany jest Anthropic albo CLI. */
  const spec = config && config.mode !== 'api' && config.mode !== 'cli' && config.mode !== 'custom'
    ? providers.find((p) => p.id === config.mode) ?? null
    : null;

  /** Bez tego przycisk „zacznij od nowa" straszy, zanim w ogóle jest co zaczynać. */
  const maPrace = Boolean(task.trim() || writer || audit);

  const ready = !config
    ? false
    : config.mode === 'cli'
      ? Boolean(config.cliCommand.trim())
      : config.mode === 'custom'
        ? // Klucz przy własnym serwerze jest opcjonalny — wystarczy poprawny adres i model.
          Boolean(normalizeBaseUrl(config.custom.baseUrl) && config.custom.model.trim())
        : config.mode === 'api'
        ? hasKey === true
        : hasKey === true && Boolean((config.models[config.mode] || '').trim());

  /** Pisarz → jeśli ma komplet informacji, od razu audytor. */
  async function run(currentAnswers: QA[]) {
    setError(null);
    setChars(0);
    setBusy('Pisarz układa prompt');
    try {
      const w = await window.agents.write(task, currentAnswers);
      setWriter(w);

      if (w.status === 'pytania' && w.questions.length > 0) {
        setAnswers(w.questions.map((q) => ({ question: q, answer: '' })));
        setStage('pytania');
        return;
      }

      setChars(0);
      setBusy('Audytor szuka luk');
      const a = await window.agents.audit(task, w.prompt, currentAnswers);
      setAudit(a);
      setStage('wynik');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const finalPrompt = audit?.finalPrompt ?? writer?.prompt ?? '';
    if (!finalPrompt) return;
    setError(null);
    setBusy('Zapisuję do katalogu…');
    try {
      const version = target
        ? await window.catalog.appendVersion(target, finalPrompt)
        : await window.catalog.createFamilyWithBody(newFamily.trim(), finalPrompt);
      await onSaved();
      setSaved(version.relPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setTask('');
    setAnswers([]);
    setWriter(null);
    setAudit(null);
    setStage('opis');
    setSaved(null);
    setTarget('');
    setNewFamily('');
  }

  const settingsPanel = config && (
    <div className="provider">
      <p className="section">Skąd bierzemy model</p>

      <div className="modes">
        <button
          className={config.mode === 'api' ? 'tab active' : 'tab'}
          onClick={() => void switchMode('api')}
        >
          Anthropic
        </button>
        {providers.map((p) => (
          <button
            key={p.id}
            className={config.mode === p.id ? 'tab active' : 'tab'}
            onClick={() => void switchMode(p.id)}
          >
            {p.label}
          </button>
        ))}
        <button
          className={config.mode === 'custom' ? 'tab active' : 'tab'}
          onClick={() => void switchMode('custom')}
        >
          Własny serwer
        </button>
        <button
          className={config.mode === 'cli' ? 'tab active' : 'tab'}
          onClick={() => void switchMode('cli')}
        >
          Lokalne CLI
        </button>
      </div>

      {config.mode === 'custom' ? (
        <>
          <p className="hint">
            Model na serwerze, który stawiasz sam — Ollama albo LM Studio na tym komputerze, vLLM czy llama.cpp
            na prywatnej maszynie. Wystarczy, że serwer mówi konwencją OpenAI (<code>/v1/chat/completions</code>).
            {isLocalHost(config.custom.baseUrl) && ' Serwer jest na tym komputerze — prompty nie wychodzą do sieci.'}
          </p>
          <div className="save-row">
            <input
              value={config.custom.baseUrl}
              placeholder="Adres serwera, np. http://localhost:11434/v1"
              onChange={(e) => setCustom({ baseUrl: e.target.value })}
            />
            {LOCAL_PRESETS.map((p) => (
              <button key={p.label} className="ghost" onClick={() => setCustom({ baseUrl: p.baseUrl })}>
                {p.label}
              </button>
            ))}
          </div>
          {!normalizeBaseUrl(config.custom.baseUrl) && config.custom.baseUrl.trim() && (
            <p className="error">To nie jest poprawny adres http(s).</p>
          )}
          {isInsecureRemote(config.custom.baseUrl) && (
            <p className="hint warn">
              Adres zaczyna się od http:// i prowadzi do innej maszyny — prompty i klucz pójdą przez sieć
              niezaszyfrowane. Jeśli serwer to umożliwia, użyj https://.
            </p>
          )}

          <div className="save-row">
            <input
              value={config.custom.model}
              placeholder="Model, np. qwen3:32b — albo wybierz z listy poniżej"
              onChange={(e) => setCustom({ model: e.target.value })}
            />
            <button onClick={() => void checkServer(config.custom.baseUrl)} disabled={checking}>
              {checking ? 'Sprawdzam…' : 'Sprawdź połączenie'}
            </button>
          </div>
          {serverCheck &&
            (serverCheck.ok ? (
              <>
                <p className="ok">
                  Serwer odpowiada.{' '}
                  {serverCheck.models.length === 0
                    ? 'Nie ma na nim żadnego modelu — w Ollamie pobierzesz go poleceniem „ollama pull nazwa”.'
                    : `Modele: ${serverCheck.models.length} — kliknij, żeby wybrać.`}
                </p>
                {serverCheck.models.length > 0 && (
                  <div className="model-pick">
                    {serverCheck.models.map((m) => (
                      <button
                        key={m}
                        className={m === config.custom.model ? 'tab active' : 'tab'}
                        onClick={() => setCustom({ model: m })}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="error">{serverCheck.error}</p>
            ))}

          <p className="hint">
            Wielkość modelu ma znaczenie: kreator wymaga odpowiedzi w ściśle określonym formacie. Modele rzędu 7–8 mld
            parametrów często go gubią; sensowne wyniki zaczynają się od ok. 14 mld, dobre od ok. 30 mld. Modele do
            osadzeń (embeddingi) i do OCR się tu nie nadają.
          </p>

          <p className="hint">
            Klucz — tylko jeśli serwer go wymaga (Ollama i LM Studio lokalnie nie wymagają).{' '}
            {hasKey ? 'Klucz jest zapisany.' : ''}
          </p>
          <div className="save-row">
            <input
              type="password"
              value={keyInput}
              placeholder={hasKey ? 'Nowy klucz (nadpisze stary)' : 'Klucz serwera (opcjonalnie)'}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button onClick={() => void saveKey()} disabled={!keyInput.trim()}>
              Zapisz klucz
            </button>
            {hasKey && (
              <button className="ghost" onClick={() => void dropKey()}>
                Usuń klucz
              </button>
            )}
          </div>
        </>
      ) : config.mode !== 'cli' ? (
        <>
          <p className="hint">
            {spec
              ? spec.keyHint
              : 'Rozmowę z Anthropic prowadzi ta aplikacja. Model: claude-opus-5, stały.'}{' '}
            Klucz szyfruje system operacyjny; nie trafia do pliku konfiguracyjnego ani do warstwy interfejsu.{' '}
            {hasKey ? 'Klucz jest zapisany.' : 'Klucza jeszcze nie ma.'}
          </p>

          {spec && (
            <input
              value={config.models[spec.id] || ''}
              placeholder={`Model — ${spec.modelHint}`}
              onChange={(e) =>
                void saveConfig({ ...config, models: { ...config.models, [spec.id]: e.target.value } })
              }
            />
          )}

          <div className="save-row">
            <input
              type="password"
              value={keyInput}
              placeholder={hasKey ? 'Nowy klucz (nadpisze stary)' : `Klucz — ${spec ? spec.label : 'Anthropic'}`}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button onClick={() => void saveKey()} disabled={!keyInput.trim()}>
              Zapisz klucz
            </button>
            {hasKey && (
              <button className="ghost" onClick={() => void dropKey()}>
                Usuń klucz
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            Rozmowę prowadzi program, który masz już zainstalowany i zalogowany — ta aplikacja nie wychodzi
            wtedy do sieci sama i nie potrzebuje klucza. Prompt idzie na standardowe wejście polecenia;
            jeśli program woli prompt w pliku, wpisz w argumentach <code>{'{promptFile}'}</code> —
            podstawimy tam ścieżkę do pliku tymczasowego.
          </p>
          <div className="save-row">
            <input
              value={config.cliCommand}
              placeholder="Polecenie, np. claude"
              onChange={(e) => void saveConfig({ ...config, cliCommand: e.target.value })}
            />
            <input
              value={config.cliArgs.join(' ')}
              placeholder="Argumenty, np. -p"
              onChange={(e) => void saveConfig({ ...config, cliArgs: e.target.value.split(/\s+/).filter(Boolean) })}
            />
          </div>
          <div className="save-row">
            <button
              className="ghost"
              onClick={() => void saveConfig({ ...config, cliCommand: 'claude', cliArgs: ['-p'] })}
            >
              Claude Code
            </button>
            <button
              className="ghost"
              onClick={() => void saveConfig({ ...config, cliCommand: 'codex', cliArgs: ['exec'] })}
            >
              Codex (konto ChatGPT)
            </button>
          </div>
          <p className="hint">
            Codex zalogowany przez „Sign in with ChatGPT" korzysta z Twojej subskrypcji ChatGPT — to jedyna
            droga, przy której płatne konto ChatGPT wystarcza i klucz API nie jest potrzebny.
          </p>
        </>
      )}
    </div>
  );

  if (!ready) {
    return (
      <div className="creator">
        <h2>Kreator promptu</h2>
        <p className="muted">
          Kreator to jedyna część aplikacji, która sięga po model. Katalog działa bez niego w całości.
          Wybierz drogę: klucz jednego z dostawców, własny serwer (np. Ollama na tym komputerze) albo lokalne
          CLI, które już masz zalogowane.
        </p>
        {settingsPanel}
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="creator">
      <div className="creator-head">
        <h2>Kreator promptu</h2>
        <div className="head-actions">
          {/* Dwa różne działania nie mogą wyglądać tak samo: chip otwiera ustawienia,
              przycisk obok kasuje pracę. Wcześniej oba były identycznymi odnośnikami. */}
          <button
            className={`chip${showSettings ? ' active' : ''}`}
            onClick={() => setShowSettings((v) => !v)}
            title="Kliknij, aby zmienić dostawcę i model"
          >
            <span className="chip-label">Model</span>
            <span className="chip-value">
              {config?.mode === 'cli'
                ? config.cliCommand
                : config?.mode === 'custom'
                  ? config.custom.model || 'nie wybrano'
                  : spec
                  ? config?.models[spec.id] || 'nie wybrano'
                  : 'claude-opus-5'}
            </span>
            <span className="chip-hint">{showSettings ? 'zamknij' : 'zmień'}</span>
          </button>

          {maPrace && (
            <button className="ghost" onClick={reset} title="Wyczyść opis, pytania i wynik">
              Zacznij od nowa
            </button>
          )}
        </div>
      </div>

      {showSettings && settingsPanel}

      {stage === 'opis' && (
        <>
          <p className="muted">
            Opisz zadanie własnymi słowami. Pisarz ułoży prompt wg pięciu zasad, a czego nie będzie wiedział —
            o to dopyta. Potem audytor poszuka w nim luk krytycznych.
          </p>
          <textarea
            className="task"
            value={task}
            placeholder="Np. potrzebuję promptu, który z notatki ze spotkania wyciągnie ustalenia i przypisze właścicieli…"
            onChange={(e) => setTask(e.target.value)}
          />
          <button onClick={() => void run([])} disabled={!task.trim() || Boolean(busy)}>
            Zbuduj prompt
          </button>
        </>
      )}

      {stage === 'pytania' && (
        <>
          <p className="section">Pisarz pyta, zanim zgadnie</p>
          {answers.map((qa, i) => (
            <div key={qa.question} className="qa">
              <label>{qa.question}</label>
              <textarea
                value={qa.answer}
                onChange={(e) => {
                  const next = [...answers];
                  next[i] = { ...qa, answer: e.target.value };
                  setAnswers(next);
                }}
              />
            </div>
          ))}
          <div className="actions">
            <button onClick={() => void run(answers)} disabled={Boolean(busy)}>
              Mam odpowiedzi, pisz dalej
            </button>
            <button onClick={() => void run(answers)} disabled={Boolean(busy)} className="ghost">
              Nie wiem — pisz z tym, co jest
            </button>
          </div>
        </>
      )}

      {stage === 'wynik' && audit && (
        <>
          {/* Wynikiem pracy jest gotowy prompt, nie raport z audytu. Ustalenia audytora
              są już w nim zawarte, więc domyślnie schodzą z oczu — zostają pod kliknięciem,
              żeby dało się sprawdzić, dlaczego prompt wygląda tak, a nie inaczej. */}
          {audit.questions.length > 0 && (
            <div className="open-questions">
              <p className="section">Zanim użyjesz — audytor nie zna odpowiedzi na to</p>
              <ul>
                {audit.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="section">Prompt finalny</p>
          {audit.keptDraft && <p className="hint warn">{audit.keptDraft}</p>}
          <textarea className="result" value={audit.finalPrompt} readOnly />

          {(audit.gaps.length > 0 || (writer?.rulesCovered.length ?? 0) > 0) && (
            <details className="rules">
              <summary>
                {audit.gaps.length > 0
                  ? `Co poprawił audytor (${audit.gaps.length})`
                  : 'Audytor nie znalazł luk'}
              </summary>
              {audit.gaps.length > 0 && (
                <ul className="gaps">
                  {audit.gaps.map((g, i) => (
                    <li key={i} className={`gap ${g.severity}`}>
                      <span className="sev">{g.severity}</span>
                      <div>
                        <strong>{g.issue}</strong>
                        <p className="muted">{g.fix}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {writer && writer.rulesCovered.length > 0 && (
                <ul>
                  {writer.rulesCovered.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </details>
          )}

          {saved ? (
            <p className="ok">Zapisano jako {saved}. Prompt jest w katalogu.</p>
          ) : (
            <div className="save-row">
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">— nowa rodzina —</option>
                {families.map((f) => (
                  <option key={f.slug} value={f.slug}>
                    {f.title}
                  </option>
                ))}
              </select>
              {!target && (
                <input
                  value={newFamily}
                  placeholder="Nazwa nowej rodziny"
                  onChange={(e) => setNewFamily(e.target.value)}
                />
              )}
              <button
                onClick={() => void save()}
                disabled={Boolean(busy) || (!target && !newFamily.trim())}
              >
                Zapisz do katalogu
              </button>
            </div>
          )}
          <p className="hint">
            Rodzinę wskazujesz sam — także tutaj. Zapis do istniejącej rodziny tworzy nową wersję pod tą,
            która jest oznaczona jako działająca.
          </p>
        </>
      )}

      {busy && (
        <div className="busy">
          <div className="busy-line">
            <span>
              {busy} · {elapsed} s{chars > 0 && ` · ${chars.toLocaleString('pl-PL')} znaków`}
            </span>
            {/* Modele rozumujące milczą przez większość pracy, więc rozdzielamy „myśli" od „pisze". */}
            <span className="busy-note">
              {chars > 0 ? 'model pisze' : 'model myśli · pierwsze słowo zwykle po 10–20 s'}
            </span>
          </div>
          <div className="bar">
            <div className="bar-run" />
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
