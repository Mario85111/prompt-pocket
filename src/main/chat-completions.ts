/**
 * Klient konwencji OpenAI (`POST …/chat/completions`, nagłówek `Authorization: Bearer`).
 *
 * Tą samą konwencją mówią OpenAI i OpenRouter, więc różnią się wyłącznie adresem,
 * nagłówkami dodatkowymi i nazwą w komunikatach o błędach. Jeden moduł, dwa wejścia —
 * inaczej dwa razy utrzymywalibyśmy to samo parsowanie strumienia.
 *
 * Struktury odpowiedzi nie wymuszamy parametrem `response_format`: obsługa jest zależna od modelu,
 * a każdy model, który jej nie zna, odrzuciłby całe żądanie. Kontrakt na format idzie w treści
 * promptu, a wynik walidujemy tym samym schematem co w pozostałych trybach — dokładnie jak w CLI.
 */

const TIMEOUT_MS = 5 * 60 * 1000;

export interface ChatRequest {
  /** Nazwa dostawcy używana w komunikatach dla użytkownika, np. „OpenAI". */
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  /** Nagłówki poza uwierzytelnieniem, np. identyfikacja aplikacji. */
  headers?: Record<string, string>;
  /** Dostaje łączną liczbę znaków odebranych do tej pory — po to, by pokazać, że model pisze. */
  onChunk?: (chars: number) => void;
}

export async function runChatCompletion(req: ChatRequest): Promise<string> {
  const { provider, endpoint, apiKey, model, system, user, headers = {}, onChunk } = req;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        model: model.trim(),
        max_tokens: 16000,
        stream: true,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${provider} nie odpowiedział w ciągu 5 minut.`);
    }
    throw new Error(`Brak połączenia z ${provider}. Katalog działa dalej bez sieci.`);
  }
  // Zegar zostaje uzbrojony aż do końca czytania strumienia — limit obejmuje całą odpowiedź,
  // nie samo nawiązanie połączenia.

  if (!response.ok) {
    clearTimeout(timer);
    throw new Error(`${provider} odrzucił żądanie (${response.status}): ${errorMessage(await response.text())}`);
  }

  // Strumień jest tym, o co prosiliśmy, ale nie każdy model go oddaje — gdy przyjdzie zwykły
  // JSON, czytamy go po staremu zamiast wywracać się na braku zdarzeń.
  const isStream = (response.headers.get('content-type') || '').includes('text/event-stream');

  let content: string;
  try {
    content = isStream
      ? await readStream(provider, response, onChunk)
      : readWholeBody(provider, await response.text());
  } catch (err) {
    clearTimeout(timer);
    // Limit czasu może wypaść także w środku czytania strumienia. Bez tego użytkownik
    // dostawał surowe „This operation was aborted" zamiast informacji, co się stało.
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
      throw new Error(`${provider} przestał odpowiadać w trakcie pisania (limit 5 minut).`);
    }
    throw err;
  }

  clearTimeout(timer);

  if (!content.trim()) throw new Error(`${provider} nie zwrócił treści.`);
  return content;
}

/** Zdarzenia SSE: linie `data: {…}`, zakończone `data: [DONE]`. */
async function readStream(
  provider: string,
  response: Response,
  onChunk?: (chars: number) => void
): Promise<string> {
  if (!response.body) throw new Error(`${provider} nie zwrócił treści.`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const interrupted = `${provider} przerwał`;
  let buffer = '';
  let content = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as StreamChunk;
        if (parsed.error?.message) throw new Error(`${interrupted}: ${parsed.error.message}`);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          content += delta;
          onChunk?.(content.length);
        }
      } catch (err) {
        // Komentarze utrzymujące połączenie i niepełne linie ignorujemy; błąd modelu przepuszczamy dalej.
        if (err instanceof Error && err.message.startsWith(interrupted)) throw err;
      }
    }
  }
  return content;
}

function readWholeBody(provider: string, text: string): string {
  let payload: ChatResponse;
  try {
    payload = JSON.parse(text) as ChatResponse;
  } catch {
    throw new Error(`${provider} zwrócił odpowiedź, która nie jest JSON-em.`);
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    // Zdarza się, gdy model istnieje, ale żądanie odbiło się o limit albo o filtr treści.
    throw new Error(
      payload?.error?.message
        ? `${provider} nie zwrócił treści: ${payload.error.message}`
        : `${provider} nie zwrócił treści.`
    );
  }
  return content;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

interface StreamChunk {
  choices?: { delta?: { content?: string } }[];
  error?: { message?: string };
}

/** Wyciąga czytelny komunikat z ciała błędu; gdy się nie da, oddaje surowy początek odpowiedzi. */
function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as ChatResponse;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    /* ciało nie jest JSON-em */
  }
  return body.slice(0, 300) || '(puste ciało odpowiedzi)';
}
