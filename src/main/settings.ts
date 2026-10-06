/**
 * Klucz API dostawcy modelu i wybór drogi do modelu.
 *
 * SCOPE §7: klucz trafia do magazynu chronionego przez system operacyjny, nigdy do pliku
 * konfiguracyjnego ani do repozytorium. Na Windows `safeStorage` szyfruje go przez DPAPI,
 * kluczem związanym z kontem użytkownika — plik skopiowany na inną maszynę jest bezużyteczny.
 *
 * Klucz NIGDY nie jest przekazywany do renderera. Renderer wie wyłącznie, czy klucz istnieje.
 * Każdy dostawca ma własny plik z kluczem — przełączenie trybu nie każe wklejać klucza od nowa.
 */

import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type { ChatProvider, KeyedMode, ProviderConfig, ProviderMode } from '../shared/types';
import type { ChatProvider, KeyedMode } from '../shared/types';
import { PROVIDERS } from './providers';

/** Anthropic ma własnego klienta, reszta dostawców z kluczem idzie przez konwencję OpenAI. */
const ENV_VAR: Record<KeyedMode, string> = {
  api: 'ANTHROPIC_API_KEY',
  openai: PROVIDERS.openai.envVar,
  gemini: PROVIDERS.gemini.envVar,
  openrouter: PROVIDERS.openrouter.envVar,
  custom: 'PROMPT_POCKET_CUSTOM_API_KEY',
};

function keyFile(mode: KeyedMode): string {
  return path.join(app.getPath('userData'), `provider-key-${mode}.bin`);
}

function configFile(): string {
  return path.join(app.getPath('userData'), 'provider.json');
}

/* ---------- wybór dostawcy ---------- */

import type { ProviderConfig, ProviderMode } from '../shared/types';

/**
 * Domyślny dostawca i modele wynikają z porównania na czterech zadaniach (2026-09-24):
 * gpt-6-sol jest w czołówce jakościowo, a pracuje 3× szybciej niż reszta czołówki.
 * Szczegóły i zastrzeżenia: porownanie-modeli-wnioski.md.
 */
const DEFAULT_CONFIG: ProviderConfig = {
  mode: 'openrouter',
  cliCommand: 'claude',
  cliArgs: ['-p'],
  models: {
    openai: 'gpt-6-sol',
    gemini: 'gemini-3.8-flash',
    openrouter: 'openai/gpt-6-sol',
  },
  // Najczęstszy przypadek własnego serwera to Ollama na tym samym komputerze.
  custom: { baseUrl: 'http://localhost:11434/v1', model: '' },
};

function isMode(value: unknown): value is ProviderMode {
  return (
    value === 'api' ||
    value === 'openai' ||
    value === 'gemini' ||
    value === 'openrouter' ||
    value === 'custom' ||
    value === 'cli'
  );
}

/** Plik konfiguracji sprzed własnego serwera nie ma tego pola — wtedy wartości domyślne. */
function readCustom(parsed: Record<string, unknown>): ProviderConfig['custom'] {
  const raw = (parsed.custom ?? {}) as Record<string, unknown>;
  return {
    baseUrl:
      typeof raw.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl.trim() : DEFAULT_CONFIG.custom.baseUrl,
    model: typeof raw.model === 'string' ? raw.model.trim() : '',
  };
}

function readModels(parsed: Record<string, unknown>): ProviderConfig['models'] {
  const raw = (parsed.models ?? {}) as Record<string, unknown>;
  const pick = (k: ChatProvider) => (typeof raw[k] === 'string' ? (raw[k] as string).trim() : '');
  return {
    openai: pick('openai'),
    gemini: pick('gemini'),
    // Zgodność wstecz: wcześniej model OpenRoutera miał własne pole.
    openrouter: pick('openrouter') || (typeof parsed.openRouterModel === 'string' ? parsed.openRouterModel.trim() : ''),
  };
}

export async function getConfig(): Promise<ProviderConfig> {
  try {
    const raw = await fs.readFile(configFile(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProviderConfig> & { openRouterModel?: string };
    return {
      mode: isMode(parsed.mode) ? parsed.mode : DEFAULT_CONFIG.mode,
      cliCommand:
        typeof parsed.cliCommand === 'string' && parsed.cliCommand.trim()
          ? parsed.cliCommand
          : DEFAULT_CONFIG.cliCommand,
      cliArgs: Array.isArray(parsed.cliArgs) ? parsed.cliArgs.map(String) : DEFAULT_CONFIG.cliArgs,
      models: readModels(parsed as Record<string, unknown>),
      custom: readCustom(parsed as Record<string, unknown>),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function setConfig(config: ProviderConfig): Promise<void> {
  const clean: ProviderConfig = {
    mode: isMode(config.mode) ? config.mode : 'api',
    cliCommand: config.cliCommand.trim() || DEFAULT_CONFIG.cliCommand,
    cliArgs: config.cliArgs.map((a) => a.trim()).filter(Boolean),
    models: {
      openai: (config.models.openai || '').trim(),
      gemini: (config.models.gemini || '').trim(),
      openrouter: (config.models.openrouter || '').trim(),
    },
    custom: {
      baseUrl: (config.custom?.baseUrl || '').trim() || DEFAULT_CONFIG.custom.baseUrl,
      model: (config.custom?.model || '').trim(),
    },
  };
  await fs.writeFile(configFile(), JSON.stringify(clean, null, 2), 'utf8');
}

/* ---------- klucze ---------- */

export async function hasApiKey(mode: KeyedMode): Promise<boolean> {
  if (process.env[ENV_VAR[mode]]) return true;
  try {
    await fs.stat(keyFile(mode));
    return true;
  } catch {
    return false;
  }
}

export async function setApiKey(mode: KeyedMode, key: string): Promise<void> {
  const clean = key.trim();
  if (!clean) {
    await clearApiKey(mode);
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'System nie udostępnia szyfrowania danych aplikacji. Klucza nie zapiszę otwartym tekstem — ' +
        `użyj zmiennej środowiskowej ${ENV_VAR[mode]}.`
    );
  }
  await fs.writeFile(keyFile(mode), safeStorage.encryptString(clean));
}

export async function clearApiKey(mode: KeyedMode): Promise<void> {
  try {
    await fs.unlink(keyFile(mode));
  } catch {
    /* nie było czego kasować */
  }
}

/** Zwraca klucz do użytku wyłącznie w procesie głównym. */
export async function readApiKey(mode: KeyedMode): Promise<string | null> {
  const fromEnv = process.env[ENV_VAR[mode]];
  if (fromEnv) return fromEnv;
  try {
    const buf = await fs.readFile(keyFile(mode), null);
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}
