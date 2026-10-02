import { useEffect, useState, type MouseEvent } from 'react';

/**
 * Instrukcja w aplikacji. Instalator nie zawiera README, więc to jest jedyna instrukcja,
 * jaką zobaczy ktoś, kto dostał sam program. Nazwy przycisków muszą zgadzać się
 * z interfejsem — przy zmianie etykiety trzeba poprawić też ten plik.
 */
export default function Help({ root, onGoToCatalog }: { root: string; onGoToCatalog: () => void }) {
  const [shortcut, setShortcut] = useState('Ctrl+Alt+P');

  useEffect(() => {
    void window.pocket.getShortcut().then((s) => setShortcut(s.label));
  }, []);

  /** Przewija do sekcji bez zmiany adresu — po #… w adresie rozpoznawane jest okno szybkiego szukania. */
  function jump(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    const id = e.currentTarget.getAttribute('href')?.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <article className="help">
      <header className="help-intro">
        <h2>Jak korzystać z Prompt Pocket</h2>
        <p>
          Prompt Pocket trzyma prompty, które działają, tak żeby wracały, kiedy znów są potrzebne. Wszystko leży
          na tym komputerze, w zwykłych plikach tekstowych.
        </p>
        <nav className="help-toc" aria-label="Spis treści">
          <a href="#h-pojecia" onClick={jump}>Trzy pojęcia</a>
          <a href="#h-start" onClick={jump}>Pierwszy prompt</a>
          <a href="#h-wersje" onClick={jump}>Wersje i notatki</a>
          <a href="#h-kopiowanie" onClick={jump}>Kopiowanie i zmienne</a>
          <a href="#h-szybkie" onClick={jump}>Szybkie szukanie</a>
          <a href="#h-kreator" onClick={jump}>Kreator</a>
          <a href="#h-dane" onClick={jump}>Pliki i kopia zapasowa</a>
          <a href="#h-skroty" onClick={jump}>Skróty</a>
          <a href="#h-pytania" onClick={jump}>Częste pytania</a>
        </nav>
      </header>

      <section id="h-pojecia">
        <h3>Trzy pojęcia</h3>
        <dl className="help-terms">
          <dt>Rodzina</dt>
          <dd>Jeden prompt do jednego rodzaju zadania, np. „Mail do klienta”. Nazwę nadajesz sam.</dd>
          <dt>Wersja</dt>
          <dd>
            Kolejne podejście do tego samego promptu: v1, v2, v3… Poprawiasz, nie nadpisując — stara wersja
            zostaje i możesz do niej wrócić.
          </dd>
          <dt>Wersja działająca</dt>
          <dd>Ta, która sprawdziła się w praktyce. Ją dostajesz, kiedy szukasz promptu na szybko.</dd>
        </dl>
      </section>

      <section id="h-start">
        <h3>Pierwszy prompt w minutę</h3>
        <ol>
          <li>
            Kliknij <b>+ Dodaj</b>, wpisz nazwę rodziny i kliknij <b>Załóż</b>.
          </li>
          <li>Wklej albo napisz treść promptu. Zapisuje się sama — przycisku „Zapisz” nie ma i nie jest potrzebny.</li>
          <li>
            Gdy prompt dał dobry wynik, kliknij <b>Oznacz jako działającą</b>.
          </li>
        </ol>
        <p className="hint">
          Masz prompty w plikach? <b>+ Dodaj → Importuj pliki .md</b> — każdy plik zakłada osobną rodzinę.
        </p>
      </section>

      <section id="h-wersje">
        <h3>Wersje, notatki i porównanie</h3>
        <ul>
          <li>
            <b>Nowa wersja z tej</b> robi kopię otwartej wersji do dalszych poprawek. Oryginał zostaje nietknięty.
          </li>
          <li>
            Pole <b>Notatka</b> nad treścią: wpisz, co zmieniłeś i dlaczego. Za miesiąc to będzie jedyny ślad,
            czym v3 różni się od v2. Notatkę widać też na liście, obok numeru wersji.
          </li>
          <li>
            <b>Porównaj</b> pokazuje różnice z inną wersją — domyślnie z tą, z której powstała. Na czerwono to,
            co usunięto, na zielono to, co doszło. <b>Wróć do edycji</b> zamyka porównanie.
          </li>
          <li>
            <b>eksport</b> przy nazwie rodziny zapisuje wszystkie wersje z notatkami w jednym pliku.
          </li>
        </ul>
      </section>

      <section id="h-kopiowanie">
        <h3>Kopiowanie i zmienne</h3>
        <p>
          <b>Kopiuj do schowka</b> kopiuje treść i zapamiętuje, kiedy prompt był użyty. Lista rodzin układa się od
          ostatnio używanych — to, po co sięgasz najczęściej, jest na górze.
        </p>
        <p>
          Jeśli prompt ma się zmieniać w kilku miejscach, wpisz tam zmienne w podwójnych nawiasach:
        </p>
        <pre className="help-example">{'Napisz maila do {{imię}} w sprawie {{temat}}. Ton: {{ton}}.'}</pre>
        <p>
          Przy kopiowaniu aplikacja zapyta o wartości i wstawi je za Ciebie. Ostatnio wpisane wartości podpowie
          następnym razem. <b>Kopiuj bez podstawiania</b> kopiuje treść razem z nawiasami.
        </p>
      </section>

      <section id="h-szybkie">
        <h3>Szybkie szukanie — {shortcut}</h3>
        <p>
          Najszybsza droga do promptu, bez przełączania się do aplikacji. W dowolnym programie naciśnij{' '}
          <kbd>{shortcut}</kbd>:
        </p>
        <ol>
          <li>wpisz kilka słów z treści albo nazwy rodziny (bez wpisywania widać ostatnio używane),</li>
          <li>
            strzałkami <kbd>↑</kbd> <kbd>↓</kbd> wybierz prompt,
          </li>
          <li>
            <kbd>Enter</kbd> — prompt jest w schowku, okno znika. Wklej go tam, gdzie pracujesz.
          </li>
        </ol>
        <p>
          Dostajesz zawsze wersję działającą, a gdy żadnej nie oznaczyłeś — najnowszą. <kbd>Esc</kbd> albo klik
          obok zamyka okno bez kopiowania.
        </p>
        <p className="hint">
          Żeby skrót działał cały czas, zamknięcie głównego okna <b>chowa aplikację do zasobnika</b> (ikona przy
          zegarze), zamiast ją wyłączać. Wyłączasz ją przez <b>Zakończ</b> w menu tej ikony.
        </p>
      </section>

      <section id="h-kreator">
        <h3>Kreator — prompt z pomocą AI</h3>
        <p>
          W zakładce <b>Kreator</b> opisujesz zadanie własnymi słowami. Dwóch agentów robi resztę:
        </p>
        <ul>
          <li>
            <b>Pisarz</b> układa prompt. Czego nie wie, o to pyta — odpowiedz na pytania i puść dalej.
          </li>
          <li>
            <b>Audytor</b> szuka luk, przez które wynik wyszedłby nie na temat albo w złym formacie, i oddaje
            prompt finalny.
          </li>
        </ul>
        <p>
          Gotowy prompt zapisujesz do wskazanej przez siebie rodziny albo do nowej. To jedyne miejsce w aplikacji,
          które łączy się z internetem.
        </p>
        <p className="hint">
          Kreator potrzebuje modelu AI. Kliknij <b>Model</b> w prawym górnym rogu Kreatora, wybierz dostawcę i wklej
          klucz API. Domyślnie to OpenRouter (klucz z openrouter.ai). Klucz jest szyfrowany przez system i nigdy nie
          trafia do plików z promptami. Abonament ChatGPT Plus to nie to samo co klucz API — wyjątek to tryb{' '}
          <b>Lokalne CLI</b> z zalogowanym programem Codex.
        </p>
      </section>

      <section id="h-dane">
        <h3>Gdzie są prompty i jak ich nie stracić</h3>
        <p>Każda wersja to zwykły plik tekstowy .md, czytelny w Notatniku:</p>
        <pre className="help-example">{root || 'C:\\Users\\<ty>\\PromptPocket'}</pre>
        <p>
          Otworzysz go przez <b>Ustawienia → Otwórz katalog na dysku</b>. Folder celowo nie leży w OneDrive — prompty
          nie opuszczają tego komputera.
        </p>
        <p>
          Dlatego zrób <b>kopię zapasową</b>: <b>Ustawienia → Kopia zapasowa → Wybierz folder</b> (najlepiej na innym
          dysku albo pendrivie), a potem zaznacz <b>Codziennie automatycznie</b>. Zostaje 10 ostatnich kopii. Żeby
          przywrócić prompty, skopiuj zawartość wybranej kopii z powrotem do folderu powyżej.
        </p>
      </section>

      <section id="h-skroty">
        <h3>Skróty</h3>
        <table className="help-keys">
          <tbody>
            <tr>
              <td>
                <kbd>{shortcut}</kbd>
              </td>
              <td>szybkie szukanie z dowolnego programu</td>
            </tr>
            <tr>
              <td>
                <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Enter</kbd>
              </td>
              <td>w szybkim szukaniu: wybierz i skopiuj</td>
            </tr>
            <tr>
              <td>
                <kbd>Enter</kbd>
              </td>
              <td>w polu nazwy nowej rodziny: załóż</td>
            </tr>
            <tr>
              <td>
                <kbd>Esc</kbd>
              </td>
              <td>zamyka okienka i szybkie szukanie</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section id="h-pytania">
        <h3>Częste pytania</h3>
        <dl className="help-terms">
          <dt>Zamknąłem okno, a aplikacja nadal działa.</dt>
          <dd>Tak ma być — siedzi w zasobniku, żeby działał skrót. Wyłączysz ją przez Zakończ w menu ikony.</dd>
          <dt>Skrót {shortcut} nie działa.</dt>
          <dd>
            Inny program zajął go wcześniej. Ustawienia → Szybkie szukanie powie, czy tak jest. Szybkie szukanie
            otworzysz wtedy z menu ikony w zasobniku.
          </dd>
          <dt>Usunąłem coś przez pomyłkę.</dt>
          <dd>Usunięte wersje i rodziny trafiają do systemowego Kosza — przywrócisz je stamtąd.</dd>
          <dt>Usunąłem wersję, a zniknęły też inne.</dt>
          <dd>
            Wersje zrobione z usuwanej wersji leżą w jej podfolderze i znikają razem z nią. Okno potwierdzenia
            wymienia je, zanim cokolwiek zniknie.
          </dd>
          <dt>Gdzie jest przycisk „Zapisz”?</dt>
          <dd>
            Nie ma go. Treść i notatka zapisują się same: 2 sekundy po ostatnim klawiszu, przy przejściu gdzie
            indziej i przy zamknięciu okna.
          </dd>
        </dl>
      </section>

      <p className="help-back">
        <button onClick={onGoToCatalog}>Do katalogu</button>
      </p>
    </article>
  );
}
