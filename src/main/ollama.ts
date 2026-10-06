/**
 * Natywne API Ollamy — używane zamiast konwencji OpenAI, gdy pod adresem własnego serwera stoi Ollama.
 *
 * Dwa powody, oba zmierzone, nie teoretyczne:
 *  1. KONTEKST. Ollama ładuje model z oknem 2048 tokenów, a przez endpoint zgodny z OpenAI nie da się
 *     tego zmienić. Instrukcja kreatora z kontraktem formatu potrafi zająć tyle sama — Ollama obcina
 *     wtedy po cichu początek rozmowy i model nie widzi części zadania. Natywne `/api/chat` przyjmuje
 *     `options.num_ctx`.
 *  2. FORMAT. Natywne API przyjmuje schemat JSON w polu `format` i wymusza go gramatyką w trakcie
 *     generowania — mały model fizycznie nie może oddać złej struktury. To był główny słaby punkt
 *     modeli lokalnych w kreatorze.
 *
 * Strumień to NDJSON: jedna linia = jeden obiekt `{ message: { content }, done }`.
 */

const DETECT_TIMEOUT_MS = 3000;

/** Okno kontekstu: zadanie, odpowiedzi autora, szkic do audytu i sama odpowiedź modelu z zapasem. */
export const OLLAMA_NUM_CTX = 8192;

/** Wynik wykrycia trzymany na czas działania aplikacji — nie pytamy serwera przy każdym wywołaniu. */
const detected = new Map<string, boolean>();

/**
 * Czy pod tym adresem stoi Ollama. `GET /api/version` to jej własny punkt końcowy —
 * LM Studio, vLLM ani llama.cpp go nie mają.
 */
export async function isOllama(origin: string): Promise<boolean> {
  const cached = detected.get(origin);
  if (cached !== undefined) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
  try {
    const response = await fetch(`${origin}/api/version`, { signal: controller.signal });
    let result = false;
    if (response.ok) {
      try {
        result = typeof ((await response.json()) as { version?: unknown }).version === 'string';
      } catch {
        result = false;
      }
    }
    // Zapamiętujemy tylko to, co serwer sam powiedział. Brak odpowiedzi (Ollama jeszcze
    // nie wstała) nie może na stałe skazać adresu na drogę bez dużego kontekstu.
    detected.set(origin, result);
    return result;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Tylko dla testów: zapomnij, co wykryto. */
export function forgetDetection(): void {
  detected.clear();
}

export interface OllamaChatRequest {
  origin: string;
  model: string;
  system: string;
  user: string;
  /** Schemat JSON odpowiedzi — Ollama wymusza go przy generowaniu. */
  schema: object;
  apiKey?: string;
  numCtx?: number;
  timeoutMs: number;
  onChunk?: (chars: number) => void;
}

export async function runOllamaChat(req: OllamaChatRequest): Promise<string> {
  const minutes = Math.round(req.timeoutMs / 60_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(`${req.origin}/api/chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(req.apiKey?.trim() ? { Authorization: `Bearer ${req.apiKey.trim()}` } : {}),
        },
        body: JSON.stringify({
          model: req.model,
          stream: true,
          format: req.schema,
          options: { num_ctx: req.numCtx ?? OLLAMA_NUM_CTX },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Ollama nie odpowiedziała w ciągu ${minutes} min.`);
      }
      throw new Error('Brak połączenia z Ollamą.');
    }

    if (!response.ok) {
      const text = await response.text();
      let message = text.slice(0, 300);
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? message;
      } catch {
        /* ciało nie jest JSON-em */
      }
      throw new Error(`Ollama odrzuciła żądanie (${response.status}): ${message}`);
    }
    if (!response.body) throw new Error('Ollama nie zwróciła treści.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';

    const handle = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let chunk: { message?: { content?: string }; error?: string };
      try {
        chunk = JSON.parse(trimmed);
      } catch {
        return; // niepełna linia — dokleimy ją przy następnym kawałku
      }
      if (chunk.error) throw new Error(`Ollama przerwała: ${chunk.error}`);
      const delta = chunk.message?.content;
      if (delta) {
        content += delta;
        req.onChunk?.(content.length);
      }
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) handle(line);
      }
      handle(buffer);
    } catch (err) {
      if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
        throw new Error(`Ollama przestała odpowiadać w trakcie pisania (limit ${minutes} min).`);
      }
      throw err;
    }

    if (!content.trim()) throw new Error('Ollama nie zwróciła treści.');
    return content;
  } finally {
    clearTimeout(timer);
  }
}
