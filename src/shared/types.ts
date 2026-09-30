/** Wspólny kontrakt między procesem głównym a rendererem. */

export interface PromptVersionMeta {
  id: string;
  familyId: string;
  parentVersionId: string | null;
  versionNo: number;
  createdAt: string;
  working: boolean;
}

export interface PromptVersion extends PromptVersionMeta {
  /** Ścieżka pliku .md względem korzenia katalogu — pokazywana użytkownikowi. */
  relPath: string;
  body: string;
}

export interface PromptFamily {
  id: string;
  title: string;
  slug: string;
  createdAt: string;
  versions: PromptVersion[];
}

export interface SearchHit {
  familyTitle: string;
  familySlug: string;
  version: PromptVersion;
  excerpt: string;
}

/* ---------- M2: agenci ---------- */

export interface WriterResult {
  status: 'pytania' | 'gotowe';
  questions: string[];
  prompt: string;
  rulesCovered: string[];
}

export interface AuditGap {
  severity: 'krytyczna' | 'istotna' | 'drobna';
  issue: string;
  fix: string;
}

export interface AuditResult {
  verdict: 'bez_zastrzezen' | 'luki';
  gaps: AuditGap[];
  questions: string[];
  finalPrompt: string;
}

export interface QA {
  question: string;
  answer: string;
}

/** Dostawcy mówiący konwencją OpenAI — jeden klient, różne adresy. */
export type ChatProvider = 'openai' | 'gemini' | 'openrouter';

/** „api" to Anthropic z własnym klientem, „cli" to program lokalny bez klucza. */
export type ProviderMode = 'api' | ChatProvider | 'cli';

/** Tryby wymagające klucza. CLI ma własne logowanie. */
export type KeyedMode = 'api' | ChatProvider;

export interface ProviderConfig {
  mode: ProviderMode;
  cliCommand: string;
  cliArgs: string[];
  /** Nazwa modelu osobno dla każdego dostawcy — przełączenie nie kasuje poprzedniego wyboru. */
  models: Record<ChatProvider, string>;
}

/** Opis dostawcy pokazywany w interfejsie; źródłem jest tabela w procesie głównym. */
export interface ProviderInfo {
  id: ChatProvider;
  label: string;
  modelHint: string;
  keyHint: string;
}

export interface AgentsApi {
  hasApiKey(mode: KeyedMode): Promise<boolean>;
  setApiKey(mode: KeyedMode, key: string): Promise<void>;
  clearApiKey(mode: KeyedMode): Promise<void>;
  getConfig(): Promise<ProviderConfig>;
  setConfig(config: ProviderConfig): Promise<void>;
  listProviders(): Promise<ProviderInfo[]>;
  write(task: string, answers: QA[]): Promise<WriterResult>;
  audit(task: string, draft: string, answers: QA[]): Promise<AuditResult>;
  /** Nasłuch postępu pracy agenta. Zwraca funkcję odpinającą. */
  onProgress(cb: (p: AgentProgress) => void): () => void;
}

export interface AgentProgress {
  phase: 'pisarz' | 'audytor';
  /** Ile znaków model zdążył napisać. Zero na drodze przez Anthropic — ta nie strumieniuje. */
  chars: number;
}

export interface CatalogApi {
  getRoot(): Promise<string>;
  listFamilies(): Promise<PromptFamily[]>;
  createFamily(title: string): Promise<PromptFamily>;
  createVersionFrom(parentRelPath: string): Promise<PromptVersion>;
  setWorkingVersion(relPath: string): Promise<void>;
  saveVersionBody(relPath: string, body: string): Promise<void>;
  search(query: string): Promise<SearchHit[]>;
  /** Dokłada nową wersję do istniejącej rodziny, wywodząc ją z wersji działającej lub ostatniej. */
  appendVersion(familySlug: string, body: string): Promise<PromptVersion>;
  /** Zakłada rodzinę i od razu zapisuje treść w v1. */
  createFamilyWithBody(title: string, body: string): Promise<PromptVersion>;
  /** Pyta, gdzie zapisać, i zapisuje treść wersji jako plik .md. Zwraca, czy zapisano. */
  exportVersion(relPath: string): Promise<boolean>;
  /** To samo dla całej rodziny — wszystkie wersje w jednym pliku. */
  exportFamily(slug: string): Promise<boolean>;
  /** Wybór plików .md; każdy zakłada osobną rodzinę. Zwraca liczbę zaimportowanych. */
  importFiles(): Promise<number>;
  /** Pyta o potwierdzenie i przenosi wersję (z wywiedzionymi) do kosza. Zwraca, czy usunięto. */
  deleteVersion(relPath: string): Promise<boolean>;
  /** Pyta o potwierdzenie i przenosi całą rodzinę do kosza. Zwraca, czy usunięto. */
  deleteFamily(slug: string, title: string): Promise<boolean>;
  revealRoot(): Promise<void>;
}

declare global {
  interface Window {
    catalog: CatalogApi;
    agents: AgentsApi;
  }
}
