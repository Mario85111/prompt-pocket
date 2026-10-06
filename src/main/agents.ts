/**
 * M2 — dwaj agenci z drugiego intentu.
 *
 *  1. PISARZ  — układa prompt wg pięciu zasad; czego nie wie, o to PYTA, zamiast zgadywać.
 *  2. AUDYTOR — szuka w gotowym prompcie luk krytycznych, dopytuje i oddaje wersję finalną.
 *
 * Dwie drogi do modelu, do wyboru przez autora (SCOPE §6):
 *  - klucz API — rozmowę prowadzi ta aplikacja,
 *  - lokalne CLI — rozmowę prowadzi program, który autor ma już zainstalowany i zalogowany.
 *
 * Treść zadania jest w obu wypadkach ta sama; różni się tylko sposób dostarczenia.
 * Wszystko żyje w procesie głównym — klucz API nigdy nie trafia do renderera.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { getConfig, readApiKey } from './settings';
import { extractJson, FormatError, runCli } from './cli';
import { listModels, runChatCompletion } from './chat-completions';
import { isOllama, runOllamaChat } from './ollama';
import { guardFinalPrompt } from '../shared/audit-guard';
import { runChatProvider } from './openrouter';
import { PROVIDERS } from './providers';
import { chatCompletionsUrl, isLocalHost, modelsUrl, nativeRoot, normalizeBaseUrl } from '../shared/endpoint';
import type { AuditResult, ChatProvider, QA, ServerCheck, WriterResult } from '../shared/types';

const MODEL = 'claude-opus-5';

/** Pięć zasad, wg których pracuje pisarz. Definicja produktu, nie detal promptu. */
const PIEC_ZASAD = `
1. ROLA I CEL — kim ma być model i po co w ogóle wykonuje to zadanie.
2. KONTEKST — dane wejściowe, odbiorca, tło sytuacji, materiały, którymi model dysponuje.
3. ZADANIE — co konkretnie ma zrobić, w jakiej kolejności, jakie jest kryterium ukończenia.
4. FORMAT WYJŚCIA — struktura, długość, język, czego w wyniku ma NIE być.
5. OGRANICZENIA I PRZYKŁADY — twarde granice, rzeczy zakazane, wzorzec dobrego wyniku.
`.trim();

const WriterSchema = z.object({
  status: z
    .enum(['pytania', 'gotowe'])
    .describe('„pytania" gdy brakuje informacji koniecznych, „gotowe" gdy prompt da się napisać'),
  questions: z
    .array(z.string())
    .describe('Pytania do autora, maksymalnie 5, tylko o rzeczy, których nie da się wywnioskować'),
  prompt: z.string().describe('Gotowy prompt — pusty, gdy status to „pytania"'),
  rulesCovered: z
    .array(z.string())
    .describe('Które z pięciu zasad zostały pokryte i czym; po jednej krótkiej linii'),
});

/**
 * Pisarz po odpowiedziach autora — tylko dla drogi, która wymusza schemat przy generowaniu (Ollama).
 *
 * Zmierzone na modelach lokalnych 4B i 12B: po otrzymaniu odpowiedzi zamiast pisać prompt zadawały
 * kolejne, nowe pytania, a 12B nie oddał promptu wcale. Instrukcja „gdy autor odpowiedział, pisz"
 * była, małe modele jej nie słuchają. Schemat, w którym „pytania" w ogóle nie są dozwolone,
 * a prompt nie może być pusty, zamyka tę pętlę. Modele w chmurze tego problemu nie miały
 * (22 przebiegi porównania) i dostają zwykły schemat.
 */
const WriterFinalSchema = WriterSchema.extend({
  status: z.literal('gotowe').describe('Autor odpowiedział na pytania — teraz piszesz prompt'),
  prompt: z.string().min(1).describe('Gotowy prompt'),
}) as unknown as z.ZodType<z.infer<typeof WriterSchema>>;

const AuditSchema = z.object({
  verdict: z.enum(['bez_zastrzezen', 'luki']).describe('Werdykt audytu'),
  gaps: z
    .array(
      z.object({
        severity: z.enum(['krytyczna', 'istotna', 'drobna']),
        issue: z.string().describe('Na czym polega luka'),
        fix: z.string().describe('Co konkretnie zostało z tym zrobione w wersji finalnej'),
      })
    )
    .describe('Znalezione luki, od najpoważniejszej'),
  questions: z
    .array(z.string())
    .describe('Pytania do autora, gdy luki krytycznej nie da się domknąć bez jego wiedzy. Maksymalnie 3'),
  finalPrompt: z.string().describe('Ulepszona, gotowa do użycia wersja promptu'),
});

/* ---------- treść zadania, wspólna dla obu dróg ---------- */

const WRITER_SYSTEM = [
  'Jesteś inżynierem promptów. Piszesz prompt, którego użyje inny model do wykonania zadania autora.',
  'Pracujesz wyłącznie po polsku.',
  '',
  'Pracujesz wedle pięciu zasad:',
  PIEC_ZASAD,
  '',
  'Zasada nadrzędna: czego nie wiesz, o to PYTASZ. Nie zmyślasz kontekstu, odbiorcy, liczb ani',
  'przykładów. Lepiej zadać trzy pytania niż oddać prompt oparty na wymyślonym tle.',
  'Pytaj tylko o rzeczy, których naprawdę nie da się wywnioskować z opisu zadania — nie przesłuchuj.',
  'Gdy autor odpowiedział już na pytania, nie zadawaj ich ponownie w innej formie: pisz prompt.',
].join('\n');

const AUDITOR_SYSTEM = [
  'Jesteś audytorem promptów. Dostajesz prompt napisany przez innego inżyniera i szukasz w nim luk,',
  'które sprawią, że wynik będzie nie na temat, w złym formacie albo oparty na niewypowiedzianym założeniu.',
  'Pracujesz wyłącznie po polsku.',
  '',
  'Sprawdzasz pokrycie pięciu zasad:',
  PIEC_ZASAD,
  '',
  'Luka KRYTYCZNA to taka, przez którą wynik będzie bezużyteczny — brak formatu wyjścia, brak odbiorcy,',
  'brak kryterium ukończenia, ukryte założenie podane jako fakt.',
  'Nie mnóż zastrzeżeń dla samego ich mnożenia: prompt bez luk kwituj werdyktem „bez_zastrzezen".',
  'Zawsze oddajesz wersję finalną — poprawioną, jeśli były luki, albo tę samą, jeśli nie było czego poprawiać.',
  'Nie dopisuj do promptu faktów, liczb ani przykładów, których autor nie podał. Brakujący fakt to pytanie,',
  'nie miejsce na twoją inwencję.',
].join('\n');

function answersBlock(answers: QA[]): string {
  if (answers.length === 0) return 'Autor nie odpowiedział jeszcze na żadne pytanie.';
  return answers
    .map((a) => `PYTANIE: ${a.question}\nODPOWIEDŹ: ${a.answer || '(brak odpowiedzi)'}`)
    .join('\n\n');
}

function writerUser(task: string, answers: QA[]): string {
  return ['ZADANIE OD AUTORA:', task, '', 'DOTYCHCZASOWE ODPOWIEDZI AUTORA:', answersBlock(answers)].join('\n');
}

function auditorUser(task: string, draft: string, answers: QA[]): string {
  return [
    'ZADANIE OD AUTORA:',
    task,
    '',
    'ODPOWIEDZI AUTORA:',
    answersBlock(answers),
    '',
    'PROMPT DO AUDYTU:',
    draft,
  ].join('\n');
}

/* ---------- droga 1: klucz API ---------- */

/**
 * Ograniczenia typu „jedna z tych wartości" nie mieszczą się w schemacie akceptowanym przez API —
 * SDK przenosi je do opisu pola, a walidacja dzieje się dopiero po stronie klienta. Model trafia
 * niemal zawsze, ale gdy raz spudłuje, cała sesja przepada. Stąd jedna cicha powtórka.
 */
async function withOneRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('structured output')) throw err;
    return call();
  }
}

async function client(): Promise<Anthropic> {
  const apiKey = await readApiKey('api');
  if (!apiKey) {
    throw new Error('Brak klucza Anthropic. Wklej go w ustawieniach albo wybierz inną drogę do modelu.');
  }
  return new Anthropic({ apiKey });
}

async function viaApi<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  const anthropic = await client();
  const response = await withOneRetry(() =>
    anthropic.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: zodOutputFormat(schema as never) },
    })
  );
  const parsed = response.parsed_output as T | null;
  if (!parsed) throw new Error('Model nie zwrócił odpowiedzi w oczekiwanej strukturze.');
  return parsed;
}

/* ---------- drogi 2 i 3: CLI oraz OpenRouter ---------- */

/**
 * Ani CLI, ani OpenRouter nie dają pewnego sposobu wymuszenia struktury odpowiedzi, więc kontrakt
 * na format dopisujemy do treści promptu, a wynik walidujemy tym samym schematem co w drodze przez API.
 */
function withFormatContract(user: string, shape: string): string {
  return [
    user,
    '',
    'FORMAT ODPOWIEDZI — bezwzględny:',
    'Odpowiedz wyłącznie jednym obiektem JSON o poniższej strukturze. Bez komentarza przed ani po,',
    'bez wyjaśnień, bez bloku kodu. Wartości tekstowe po polsku.',
    shape,
  ].join('\n');
}

/**
 * Jedna powtórka, gdy model nie dotrzyma kontraktu formatu.
 * Droga przez Anthropic ma to od dawna (schemat waliduje SDK); pozostałe drogi dostały to
 * po tym, jak w porównaniu modeli jeden z nich pominął pole i zabrał ze sobą całą sesję.
 * Powtarzamy wyłącznie błąd struktury — sieci, limitów ani odmów nie ponawiamy.
 */
async function withFormatRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof FormatError)) throw err;
    return call();
  }
}

function validate<T>(source: string, raw: string, schema: z.ZodType<T>): T {
  const json = extractJson(raw);
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new FormatError(
      `Odpowiedź z ${source} nie pasuje do oczekiwanej struktury: ${result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')} — ${i.message}`)
        .join('; ')}`
    );
  }
  return result.data;
}

async function viaCli<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  shape: string,
  onChunk?: OnChunk
): Promise<T> {
  const config = await getConfig();
  const raw = await runCli(config, [system, '', withFormatContract(user, shape)].join('\n'), onChunk);
  return validate('CLI', raw, schema);
}

async function viaChatProvider<T>(
  provider: ChatProvider,
  system: string,
  user: string,
  schema: z.ZodType<T>,
  shape: string,
  onChunk?: OnChunk
): Promise<T> {
  const config = await getConfig();
  const spec = PROVIDERS[provider];
  const apiKey = await readApiKey(provider);
  if (!apiKey) {
    throw new Error(`Brak klucza dla ${spec.label}. Wklej go w ustawieniach kreatora.`);
  }
  return withFormatRetry(async () => {
    const raw = await runChatProvider(
      provider,
      apiKey,
      config.models[provider] || '',
      system,
      withFormatContract(user, shape),
      onChunk
    );
    return validate(spec.label, raw, schema);
  });
}

/* ---------- droga 4: własny serwer (Ollama, LM Studio, vLLM…) ---------- */

/**
 * Model lokalny na zwykłym komputerze — zwłaszcza na samym procesorze — pisze wolno,
 * a pierwsze wywołanie dokłada jeszcze ładowanie modelu do pamięci. Stąd dłuższy limit.
 */
const CUSTOM_TIMEOUT_MS = 15 * 60 * 1000;

async function viaCustom<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  shape: string,
  onChunk?: OnChunk,
  /** Ostrzejszy schemat dla Ollamy, która wymusza go przy generowaniu (patrz WriterFinalSchema). */
  enforced?: z.ZodType<T>
): Promise<T> {
  const { custom } = await getConfig();
  const endpoint = chatCompletionsUrl(custom.baseUrl);
  if (!endpoint) throw new Error(`Adres serwera „${custom.baseUrl}" jest niepoprawny. Popraw go w ustawieniach kreatora.`);
  if (!custom.model) throw new Error('Nie wybrano modelu na własnym serwerze. Wybierz go w ustawieniach kreatora.');
  const apiKey = (await readApiKey('custom')) ?? '';
  // Ollama dostaje własne API: większy kontekst i schemat wymuszany przy generowaniu (patrz ollama.ts).
  const root = nativeRoot(custom.baseUrl);
  const ollama = root ? await isOllama(root) : false;

  return withFormatRetry(async () => {
    let raw: string;
    try {
      raw =
        ollama && root
          ? await runOllamaChat({
              origin: root,
              model: custom.model,
              system,
              user: withFormatContract(user, shape),
              schema: z.toJSONSchema(enforced ?? schema),
              apiKey,
              timeoutMs: CUSTOM_TIMEOUT_MS,
              onChunk,
            })
          : await runChatCompletion({
              provider: 'Serwer modelu',
              endpoint,
              apiKey,
              model: custom.model,
              system,
              user: withFormatContract(user, shape),
              onChunk,
              timeoutMs: CUSTOM_TIMEOUT_MS,
            });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Ogólny komunikat „katalog działa bez sieci" myli przy serwerze na tym samym komputerze.
      if (message.startsWith('Brak połączenia')) {
        throw new Error(
          isLocalHost(custom.baseUrl)
            ? `Nie ma połączenia z serwerem pod ${normalizeBaseUrl(custom.baseUrl)}. Czy Ollama (albo LM Studio) jest uruchomiona?`
            : `Nie ma połączenia z serwerem pod ${normalizeBaseUrl(custom.baseUrl)}. Sprawdź adres i czy serwer działa.`
        );
      }
      throw err;
    }
    return validate(`modelu ${custom.model}`, raw, ollama && enforced ? enforced : schema);
  });
}

/** Sprawdza serwer i pobiera listę modeli — dla przycisku „Sprawdź połączenie". */
export async function checkServer(baseUrl: string): Promise<ServerCheck> {
  const url = modelsUrl(baseUrl);
  if (!url) return { ok: false, models: [], error: 'To nie jest poprawny adres http(s).' };
  try {
    const models = await listModels(url, (await readApiKey('custom')) ?? '');
    return { ok: true, models, error: null };
  } catch (err) {
    return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

const WRITER_SHAPE = `{
  "status": "pytania" | "gotowe",
  "questions": ["pytanie do autora", ...],   // pusta tablica, gdy status to "gotowe"
  "prompt": "gotowy prompt",                  // pusty łańcuch, gdy status to "pytania"
  "rulesCovered": ["zasada 1: ...", ...]
}`;

const AUDIT_SHAPE = `{
  "verdict": "bez_zastrzezen" | "luki",
  "gaps": [{ "severity": "krytyczna" | "istotna" | "drobna", "issue": "...", "fix": "..." }],
  "questions": ["pytanie do autora", ...],
  "finalPrompt": "finalna wersja promptu"
}`;

/* ---------- wejścia publiczne ---------- */

/**
 * Postęp: łączna liczba znaków, które model zdążył napisać.
 * Droga przez Anthropic nie strumieniuje (odpowiedź jest walidowana schematem w całości),
 * więc tam licznik zostaje na zerze — interfejs pokazuje wtedy sam upływ czasu.
 */
export type OnChunk = (chars: number) => void;

/** Kieruje zadanie na drogę wybraną przez autora. Treść zadania jest w każdej z nich ta sama. */
async function dispatch<T>(
  system: string,
  user: string,
  schema: z.ZodType<T>,
  shape: string,
  onChunk?: OnChunk,
  enforced?: z.ZodType<T>
): Promise<T> {
  const { mode } = await getConfig();
  if (mode === 'cli') return viaCli(system, user, schema, shape, onChunk);
  if (mode === 'custom') return viaCustom(system, user, schema, shape, onChunk, enforced);
  if (mode !== 'api') return viaChatProvider(mode, system, user, schema, shape, onChunk);
  return viaApi(system, user, schema);
}

/** Agent 1: pisze prompt albo dopytuje. */
export async function writePrompt(task: string, answers: QA[], onChunk?: OnChunk): Promise<WriterResult> {
  // Po jednej rundzie odpowiedzi pisarz ma pisać, nie dopytywać — tam, gdzie da się to wymusić.
  const enforced = answers.length > 0 ? WriterFinalSchema : undefined;
  return dispatch(WRITER_SYSTEM, writerUser(task, answers), WriterSchema, WRITER_SHAPE, onChunk, enforced);
}

/** Agent 2: audytuje wynik pierwszego i oddaje wersję finalną. */
export async function auditPrompt(
  task: string,
  draft: string,
  answers: QA[],
  onChunk?: OnChunk
): Promise<AuditResult> {
  const result = await dispatch(AUDITOR_SYSTEM, auditorUser(task, draft, answers), AuditSchema, AUDIT_SHAPE, onChunk);
  return guardFinalPrompt(draft, result);
}

/** Zamienia błąd na komunikat, który da się pokazać autorowi. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Klucz API został odrzucony przez dostawcę.';
  if (err instanceof Anthropic.RateLimitError) return 'Limit zapytań u dostawcy. Spróbuj za chwilę.';
  if (err instanceof Anthropic.BadRequestError) return `Żądanie odrzucone: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError)
    return 'Brak połączenia z dostawcą modelu. Katalog działa dalej bez sieci.';
  if (err instanceof Anthropic.APIError) return `Błąd dostawcy (${err.status}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
