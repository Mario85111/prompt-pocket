/**
 * Wejście dla dostawców mówiących konwencją OpenAI: OpenAI, Gemini, OpenRouter.
 * Samo żądanie i strumień siedzą w `chat-completions.ts`, różnice — w `providers.ts`.
 */

import { runChatCompletion } from './chat-completions';
import { PROVIDERS } from './providers';
import type { ChatProvider } from '../shared/types';

export async function runChatProvider(
  provider: ChatProvider,
  apiKey: string,
  model: string,
  system: string,
  user: string,
  onChunk?: (chars: number) => void
): Promise<string> {
  const spec = PROVIDERS[provider];
  if (!model.trim()) {
    throw new Error(`Nie podałeś modelu dla ${spec.label}. Wpisz ${spec.modelHint}.`);
  }
  return runChatCompletion({
    provider: spec.label,
    endpoint: spec.endpoint,
    headers: spec.headers,
    apiKey,
    model,
    system,
    user,
    onChunk,
  });
}

/** Zachowane wejście po nazwie — używane przez testy ścieżki OpenRoutera. */
export function runOpenRouter(
  apiKey: string,
  model: string,
  system: string,
  user: string,
  onChunk?: (chars: number) => void
): Promise<string> {
  return runChatProvider('openrouter', apiKey, model, system, user, onChunk);
}
