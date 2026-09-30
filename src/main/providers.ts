/**
 * Dostawcy mówiący konwencją OpenAI. Różnią się adresem, zmienną środowiskową i nazwą modelu —
 * cała reszta (strumień, błędy, walidacja) jest wspólna, więc trzymamy to w tabeli, nie w trzech modułach.
 *
 * Adresy da się podmienić zmienną środowiskową — wyłącznie po to, by dało się to przetestować lokalnie.
 */

import type { ChatProvider } from '../shared/types';

export interface ProviderSpec {
  label: string;
  endpoint: string;
  envVar: string;
  headers?: Record<string, string>;
  /** Podpowiedź w polu modelu — nazwy modeli zmieniają się częściej niż ta aplikacja. */
  modelHint: string;
  /** Gdzie użytkownik bierze klucz. */
  keyHint: string;
}

export const PROVIDERS: Record<ChatProvider, ProviderSpec> = {
  openai: {
    label: 'OpenAI',
    endpoint: process.env.KATALOG_OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions',
    envVar: 'OPENAI_API_KEY',
    modelHint: 'nazwa modelu z platform.openai.com',
    keyHint:
      'Klucz z platform.openai.com — to NIE to samo co subskrypcja ChatGPT Plus. API rozlicza się osobno. ' +
      'Masz tylko konto ChatGPT? Użyj trybu „Lokalne CLI" z Codexem zalogowanym swoim kontem.',
  },
  gemini: {
    label: 'Gemini',
    endpoint:
      process.env.KATALOG_GEMINI_ENDPOINT ||
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    envVar: 'GEMINI_API_KEY',
    modelHint: 'np. gemini-3.8-flash',
    keyHint: 'Klucz z aistudio.google.com.',
  },
  openrouter: {
    label: 'OpenRouter',
    endpoint: process.env.KATALOG_OPENROUTER_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions',
    envVar: 'OPENROUTER_API_KEY',
    // Identyfikacja aplikacji. Nagłówka HTTP-Referer nie wysyłamy — aplikacja lokalna
    // nie ma adresu, a wysyłanie czegokolwiek ponad konieczność jest tu bez sensu.
    headers: { 'X-OpenRouter-Title': 'Prompt Pocket' },
    modelHint: 'slug ze strony openrouter.ai/models',
    keyHint: 'Klucz z openrouter.ai — jeden klucz, dostęp do modeli wielu dostawców.',
  },
};
