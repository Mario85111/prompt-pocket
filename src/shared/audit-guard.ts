/**
 * Zabezpieczenie wersji finalnej audytora.
 *
 * Zmierzone na modelu lokalnym 12B: audytor trafnie wskazał luki, ale jego „wersja finalna"
 * urwała się w pół zdania — 470 znaków przy szkicu 972. JSON był poprawny, więc walidacja
 * struktury tego nie łapie. Audytor ma oddawać szkic poprawiony, a nie skrócony o połowę;
 * wyraźnie krótszy tekst to prawie zawsze urwana odpowiedź. Wtedy zostawiamy szkic pisarza
 * i mówimy o tym wprost — lepszy kompletny szkic niż połowa poprawionego.
 */

import type { AuditResult } from './types';

/** Poniżej tej części długości szkicu wersja audytora uznawana jest za urwaną. */
export const MIN_FINAL_RATIO = 0.6;

export function guardFinalPrompt(draft: string, result: AuditResult): AuditResult {
  const draftLen = draft.trim().length;
  const finalLen = result.finalPrompt.trim().length;
  if (draftLen === 0 || finalLen >= draftLen * MIN_FINAL_RATIO) return result;
  return {
    ...result,
    finalPrompt: draft,
    keptDraft:
      `Wersja audytora była wyraźnie krótsza od szkicu (${finalLen} zn. wobec ${draftLen}) — wygląda na urwaną, ` +
      'więc zostawiłem szkic pisarza. Uwagi audytora poniżej nadal warto przejrzeć i wprowadzić ręcznie.',
  };
}
