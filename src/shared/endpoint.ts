/**
 * Adres własnego serwera modelu (Ollama, LM Studio, vLLM, llama.cpp, LiteLLM…).
 *
 * Wszystkie mówią konwencją OpenAI pod ścieżką `…/v1`. Autor wpisuje adres tak, jak go zna —
 * `localhost:11434`, `http://serwer:8000/v1`, czasem pełny `…/chat/completions` — a stąd
 * powstaje jeden, przewidywalny adres bazowy. Moduł jest czysty: używa go proces główny,
 * interfejs (podgląd i ostrzeżenia) i testy.
 */

/** Gotowe adresy dla programów, które stawia się lokalnie. */
export const LOCAL_PRESETS = [
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
  { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
] as const;

/**
 * Adres bazowy kończący się na `/v1` (albo na tym, co autor świadomie podał jako ścieżkę).
 * Zwraca null, gdy z wpisu nie da się zrobić adresu http(s).
 */
export function normalizeBaseUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  // Sam host z portem („localhost:11434") — zakładamy http, bo tak działają serwery lokalne.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `http://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  let pathname = url.pathname.replace(/\/+$/, '');
  // Wklejony pełny adres punktu końcowego — zostawiamy samą bazę.
  pathname = pathname.replace(/\/(chat\/completions|models)$/, '');
  // Bez ścieżki — standardowe /v1, które mają wszystkie znane serwery zgodne z OpenAI.
  if (!pathname) pathname = '/v1';

  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function chatCompletionsUrl(baseUrl: string): string | null {
  const base = normalizeBaseUrl(baseUrl);
  return base ? `${base}/chat/completions` : null;
}

export function modelsUrl(baseUrl: string): string | null {
  const base = normalizeBaseUrl(baseUrl);
  return base ? `${base}/models` : null;
}

/**
 * Korzeń serwera bez końcowego `/v1` — pod nim Ollama ma własne API (`/api/chat`, `/api/version`).
 * Zachowuje ścieżkę, gdy serwer stoi za odwrotnym proxy pod podkatalogiem.
 */
export function nativeRoot(baseUrl: string): string | null {
  const base = normalizeBaseUrl(baseUrl);
  return base ? base.replace(/\/v1$/, '') : null;
}

/** Czy serwer stoi na tym komputerze — wtedy nic nie wychodzi do sieci. */
export function isLocalHost(baseUrl: string): boolean {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return false;
  const host = new URL(base).hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127\./.test(host);
}

/**
 * http:// do innej maszyny niż ta: klucz i treść promptów idą przez sieć otwartym tekstem.
 * Interfejs ostrzega — nie blokuje, bo w zaufanej sieci domowej bywa to świadomy wybór.
 */
export function isInsecureRemote(baseUrl: string): boolean {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return false;
  return new URL(base).protocol === 'http:' && !isLocalHost(base);
}
