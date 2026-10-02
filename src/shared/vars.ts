/**
 * Zmienne w promptach: `{{nazwa}}` w treści. Przy kopiowaniu aplikacja pyta o wartości
 * i podstawia je, więc jeden prompt obsługuje wiele podobnych zadań.
 *
 * Nazwa to litery (także polskie), cyfry, spacja, podkreślnik i myślnik; białe znaki
 * wokół nazwy są ignorowane — `{{ temat }}` i `{{temat}}` to ta sama zmienna.
 */

const VAR = /\{\{\s*([\p{L}\p{N}_ -]+?)\s*\}\}/gu;

/** Nazwy zmiennych w kolejności pierwszego wystąpienia, bez powtórzeń. */
export function findVars(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(VAR)) seen.add(m[1]);
  return [...seen];
}

/** Podstawia wartości. Zmienna bez podanej wartości zostaje w treści nietknięta. */
export function fillVars(text: string, values: Record<string, string>): string {
  return text.replace(VAR, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole
  );
}
