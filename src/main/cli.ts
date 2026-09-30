/**
 * Druga ścieżka do modelu: lokalne CLI zamiast klucza API.
 *
 * Nic tu nie idzie do sieci z tej aplikacji — rozmowę z dostawcą prowadzi program,
 * który autor ma już zainstalowany i zalogowany. My podajemy prompt na standardowe wejście
 * i czytamy odpowiedź ze standardowego wyjścia.
 *
 * Prompt idzie przez stdin, nie w argumencie polecenia: treść promptu bywa dłuższa
 * niż limit długości linii poleceń Windows i łatwo o kłopot ze znakami specjalnymi.
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProviderConfig } from './settings';

const TIMEOUT_MS = 5 * 60 * 1000;

export async function runCli(
  config: ProviderConfig,
  prompt: string,
  onChunk?: (chars: number) => void
): Promise<string> {
  // Nie każdy program czyta prompt ze standardowego wejścia. Gdy autor wpisze {promptFile}
  // w argumentach, podstawiamy tam ścieżkę do pliku tymczasowego z treścią.
  //
  // Celowo plik, a nie sama treść w argumencie: prompt bywa wielolinijkowy i pełen cudzysłowów,
  // a wiersz poleceń Windows ma i limit długości, i własne zasady cytowania — plik omija oba.
  const usesFile = config.cliArgs.some((a) => a.includes('{promptFile}'));
  let promptFile = '';
  if (usesFile) {
    promptFile = path.join(os.tmpdir(), `prompt-pocket-${process.pid}-${Date.now()}.txt`);
    await fs.writeFile(promptFile, prompt, 'utf8');
  }
  const args = usesFile ? config.cliArgs.map((a) => a.replace('{promptFile}', promptFile)) : config.cliArgs;

  try {
    return await spawnAndRead(config, args, prompt, usesFile, onChunk);
  } finally {
    // Plik tymczasowy znika zawsze — także gdy polecenie padło albo przekroczyło limit czasu.
    if (promptFile) await fs.rm(promptFile, { force: true });
  }
}

function spawnAndRead(
  config: ProviderConfig,
  args: string[],
  prompt: string,
  usesFile: boolean,
  onChunk?: (chars: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.cliCommand, args, {
      // shell: true — bo na Windows polecenia instalowane przez npm to pliki .cmd,
      // których spawn bez powłoki nie uruchomi.
      shell: true,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new Error(`Polecenie „${config.cliCommand}" nie odpowiedziało w ciągu 5 minut.`));
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      onChunk?.(stdout.length);
    });
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));

    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const hint =
        'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `Nie znalazłem polecenia „${config.cliCommand}". Sprawdź nazwę albo podaj pełną ścieżkę.`
          : err.message;
      reject(new Error(hint));
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Polecenie „${config.cliCommand}" zakończyło się kodem ${code}.` +
              (stderr.trim() ? ` Komunikat: ${stderr.trim().slice(0, 400)}` : '')
          )
        );
        return;
      }
      resolve(stdout);
    });

    // Gdy treść poszła plikiem, wejście tylko domykamy — inaczej program czekałby na dane.
    child.stdin.end(usesFile ? '' : prompt, 'utf8');
  });
}

/** Błąd formatu odpowiedzi — jedyny rodzaj, który wolno ponowić. */
export class FormatError extends Error {}

/**
 * Wyciąga obiekt JSON z odpowiedzi modelu. Program może opakować wynik w bloki kodu
 * albo dopisać zdanie od siebie — bierzemy pierwszy kompletny obiekt.
 *
 * Znaki sterujące wewnątrz łańcuchów escapujemy w locie: treść promptu jest z natury
 * wielolinijkowa, a modele nagminnie wstawiają surowy znak nowej linii w miejsce `
`.
 * Bez tego `JSON.parse` wywracał całą sesję na poprawnym merytorycznie wyniku.
 */
export function extractJson(text: string): unknown {
  // Kandydatów próbujemy po kolei, bo prompt bywa naszpikowany blokami kodu:
  // przy zadaniach o programowaniu pierwszy blok w odpowiedzi to zwykle przykład
  // w Pythonie, a nie JSON. Najpierw bloki oznaczone jako json, potem pozostałe
  // bloki, na końcu cały tekst.
  const oznaczone = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const wszystkie = [...text.matchAll(/```(?:[a-z]*)\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  const kandydaci = [...oznaczone, ...wszystkie, text];

  let ostatniBlad: FormatError | null = null;
  for (const kandydat of kandydaci) {
    try {
      return parseFirstObject(kandydat);
    } catch (err) {
      if (err instanceof FormatError) ostatniBlad = err;
      else throw err;
    }
  }
  throw ostatniBlad ?? new FormatError('Odpowiedź nie zawiera obiektu JSON.');
}

function parseFirstObject(candidate: string): unknown {
  const start = candidate.indexOf('{');
  if (start === -1) throw new FormatError('Odpowiedź nie zawiera obiektu JSON.');

  // Domykanie po nawiasach, z pominięciem tych wewnątrz łańcuchów znaków.
  // Po drodze przepisujemy treść, escapując znaki sterujące wewnątrz łańcuchów.
  const ESCAPE: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
  let out = '';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      } else if (ch < ' ') {
        out += ESCAPE[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
        continue;
      }
      out += ch;
      continue;
    }

    out += ch;
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(out);
        } catch (err) {
          throw new FormatError(
            `Odpowiedź nie jest poprawnym JSON-em: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }
  throw new FormatError('Odpowiedź zawiera niedomknięty JSON.');
}
