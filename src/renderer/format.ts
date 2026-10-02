/** Krótki, ludzki opis tego, kiedy prompt był ostatnio użyty. */
export function whenUsed(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(then)) / 86_400_000);

  if (days <= 0) return 'użyto dziś';
  if (days === 1) return 'użyto wczoraj';
  if (days < 7) return `użyto ${days} dni temu`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? 'użyto tydzień temu' : `użyto ${weeks} tyg. temu`;
  }
  return `użyto ${then.toLocaleDateString('pl-PL')}`;
}

/** IPC dokleja do komunikatu techniczny przedrostek — autor ma zobaczyć samą treść błędu. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
