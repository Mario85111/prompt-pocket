import { useState } from 'react';

/**
 * Ostatnio wpisane wartości zmiennych, wspólne dla wszystkich promptów w tej sesji okna.
 * Ten sam {{język}} zwykle ma tę samą wartość w kolejnych użyciach — nie każemy wpisywać od nowa.
 */
const remembered: Record<string, string> = {};

interface Props {
  vars: string[];
  /** Kopiuj z podstawionymi wartościami. */
  onSubmit: (values: Record<string, string>) => void;
  /** Kopiuj treść tak, jak jest, ze zmiennymi w nawiasach. */
  onRaw: () => void;
  onCancel: () => void;
}

/** Pyta o wartości zmiennych {{…}} przed skopiowaniem promptu. */
export default function VarsForm({ vars, onSubmit, onRaw, onCancel }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(vars.map((v) => [v, remembered[v] ?? '']))
  );

  function submit() {
    Object.assign(remembered, values);
    onSubmit(values);
  }

  return (
    <form
      className="vars-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <span className="tag wide">Uzupełnij zmienne</span>
      {vars.map((name, i) => (
        <label key={name} className="vars-row">
          <span className="vars-name">{`{{${name}}}`}</span>
          <input
            autoFocus={i === 0}
            value={values[name] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [name]: e.target.value }))}
          />
        </label>
      ))}
      <div className="vars-actions">
        <button type="submit">Kopiuj z wartościami</button>
        <button type="button" className="ghost" onClick={onRaw}>
          Kopiuj bez podstawiania
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Anuluj
        </button>
      </div>
    </form>
  );
}
