# Prompt Pocket

Aplikacja desktopowa do tworzenia i katalogowania promptów wg [SCOPE.md](SCOPE.md).
Zrealizowane wszystkie MUST-y M-1…M-7 (katalog) oraz M2 (kreator: agent piszący + agent audytujący).

Wchodzisz w projekt po przerwie? Zacznij od [STAN-PROJEKTU.md](STAN-PROJEKTU.md) — stan, decyzje
i otwarte punkty w jednym miejscu.

Aplikacja ma dwie zakładki: **Katalog** — to, co zapisane; **Kreator** — budowanie nowego promptu z pomocą
dwóch agentów. Katalog działa w całości bez sieci; kreator jest jedynym miejscem, które wychodzi na zewnątrz.

## Uruchomienie

```bash
npm install
npm start
```

Tryb deweloperski z przeładowaniem renderera:

```bash
npm run dev
```

Instalator Windows (NSIS, x64) — powstaje w `release/`:

```bash
npm run dist
```

## Gdzie leżą dane

`C:\Users\<użytkownik>\PromptPocket`

SCOPE zakładał `Documents`, ale folder Dokumenty jest tu przekierowany do OneDrive, co łamie
ograniczenie „dane nie opuszczają maszyny" (SCOPE §7). Wygrywa ograniczenie.
Ścieżkę nadpisuje zmienna `PROMPT_POCKET_ROOT` (stara `KATALOG_PROMPTOW_ROOT` nadal działa).

Aplikacja nazywała się wcześniej „Katalog Promptów". Przy pierwszym uruchomieniu po zmianie nazwy
stary katalog `KatalogPromptow` jest przenoszony do `PromptPocket`, a ustawienia (klucze, wybór dostawcy,
skórka) kopiowane z `%APPDATA%\katalog-promptow` do `%APPDATA%\prompt-pocket` — o ile nowe miejsca są puste.

Struktura na dysku:

```
PromptPocket/
  <slug-rodziny>/
    _rodzina.md        metadane rodziny (tytuł, id, data)
    v1.md              wersja pierwsza
    v1/
      v2.md            wersja wywiedziona z v1
      v2/
        v3.md          wersja wywiedziona z v2
```

Pliki są źródłem prawdy. Aplikacja nie przechowuje niczego, czego nie ma w pliku `.md`.
Indeks wyszukiwania żyje w pamięci i odbudowuje się ze skanu katalogu.

## Co działa (MUST M-1…M-7)

| # | funkcja |
|---|---|
| M-1 | rodziny zakładane ręcznie; nowa wersja ląduje w podkatalogu wersji, z której powstała, i dziedziczy jej treść |
| M-2 | autozapis 2 s po ostatnim klawiszu, przy utracie fokusu i przy zamknięciu okna; **brak przycisku „Zapisz"**; zapis atomowy |
| M-3 | oznaczenie wersji działającej — w rodzinie zawsze co najwyżej jedna |
| M-4 | wyszukiwanie po treści i tytule z fragmentem trafienia |
| M-5 | ~~licznik użyć~~ — usunięty na życzenie autora 2026-09-23; zostało kopiowanie do schowka |
| M-6 | magazyn plikowy czytelny w notatniku; indeks w pełni odtwarzalny ze skanu |
| M-7 | instalator NSIS x64 (`npm run dist`) |

## Kreator (M2)

Dwa przebiegi, jeden po drugim:

1. **Pisarz** układa prompt wg pięciu zasad — rola i cel, kontekst, zadanie, format wyjścia, ograniczenia
   i przykłady. Czego nie wie, o to pyta; nie dopisuje kontekstu z własnej głowy.
2. **Audytor** czyta gotowy prompt i szuka luk, przez które wynik wyjdzie nie na temat lub w złym formacie.
   Luki dzieli na krytyczne, istotne i drobne, w razie potrzeby dopytuje i oddaje wersję finalną.

Wynik zapisujesz do rodziny, którą **wskazujesz sam** — do istniejącej (powstaje wersja pod tą oznaczoną
jako działająca) albo do nowej. Aplikacja nadal nie zgaduje przynależności.

### Skąd bierzemy model — pięć dróg do wyboru

| droga | jak działa | czego wymaga |
|---|---|---|
| **Anthropic** | własny klient SDK, model `claude-opus-5` | klucz w kreatorze albo `ANTHROPIC_API_KEY` |
| **OpenAI** | konwencja OpenAI | klucz z platform.openai.com albo `OPENAI_API_KEY` **oraz** nazwa modelu |
| **Gemini** | konwencja OpenAI (endpoint zgodności Google) | klucz z aistudio.google.com albo `GEMINI_API_KEY` **oraz** nazwa modelu |
| **OpenRouter** | konwencja OpenAI | klucz z openrouter.ai albo `OPENROUTER_API_KEY` **oraz** slug modelu |
| **Lokalne CLI** | rozmowę prowadzi program, który masz zainstalowany i zalogowany | polecenie w PATH lub pełna ścieżka |

**Płatne konto ChatGPT to nie to samo co klucz API OpenAI.** Subskrypcja ChatGPT Plus/Pro działa wyłącznie
w ChatGPT; dostęp programowy wymaga osobnego klucza z platform.openai.com, rozliczanego osobno.
Jedyna droga, przy której **wystarcza samo konto ChatGPT**, to tryb **Lokalne CLI** z Codexem zalogowanym
przez „Sign in with ChatGPT" — w kreatorze jest na to gotowy przycisk (`codex exec`).

**Domyślnie: OpenRouter z modelem `openai/gpt-6-sol`** — wybór z porównania na czterech zadaniach
([porownanie-modeli-wnioski.md](porownanie-modeli-wnioski.md)): jakościowo w czołówce, a pracuje
w ~20 s zamiast 58–77 s. Przełącznik jest w kreatorze; wybór zapisuje się w `provider.json`
w danych aplikacji.
Każdy dostawca ma własny plik z kluczem, więc przełączenie trybu nie każe wklejać klucza od nowa.

**OpenAI, Gemini i OpenRouter** mówią tą samą konwencją (`POST …/chat/completions`, `Authorization: Bearer`),
więc obsługuje je jeden klient; różnice — adres, zmienna środowiskowa, podpowiedź modelu — siedzą w tabeli
w `src/main/providers.ts`. Struktury odpowiedzi nie wymuszamy parametrem `response_format`, bo jego obsługa
zależy od modelu, a model, który go nie zna, odrzuciłby całe żądanie; kontrakt na format idzie w treści
promptu i jest walidowany tym samym schematem co w pozostałych trybach.

**Klucz API** trafia do magazynu chronionego przez system (DPAPI na Windows), nigdy do pliku
konfiguracyjnego ani do repozytorium, i nigdy nie jest przekazywany do warstwy interfejsu —
wszystkie wywołania modelu żyją w procesie głównym.

**W trybie CLI** aplikacja nie wychodzi do sieci sama i nie potrzebuje klucza. Prompt idzie na standardowe
wejście polecenia (nie w argumencie — treść bywa dłuższa niż limit linii poleceń Windows), a odpowiedź
czytana jest ze standardowego wyjścia. Program, który woli prompt w pliku, obsłużysz wpisując
`{promptFile}` w argumentach — podstawimy tam ścieżkę do pliku tymczasowego, kasowanego po wykonaniu.
JSON jest wyłuskiwany nawet wtedy, gdy program opakuje go w blok kodu albo doda zdanie od siebie,
i walidowany tym samym schematem co odpowiedź z API.

Model w trybie API: `claude-opus-5`, adaptacyjne myślenie, odpowiedzi w strukturze wymuszonej schematem.
W trybie CLI o model decyduje wywoływany program.

### Postęp pracy agenta

Pełny przebieg trwa kilkadziesiąt sekund, więc kreator pokazuje licznik czasu, pasek aktywności
i liczbę znaków, które model zdążył napisać. OpenRouter i CLI raportują postęp na żywo (strumień SSE
i standardowe wyjście); droga przez Anthropic nie strumieniuje, bo odpowiedź jest walidowana schematem
w całości — tam widać sam upływ czasu.

Zmierzone na `anthropic/claude-sonnet-5` przez OpenRouter: pierwszy znak po ~11 s, cała odpowiedź
w ciągu kolejnych kilku milisekund. Modele rozumujące milczą przez większość pracy, dlatego interfejs
rozróżnia „model myśli" od „model pisze" — sam licznik znaków niczego by nie powiedział.

## Skórki

Siedem motywów, przełącznik na dole panelu bocznego; wybór zapamiętuje się między uruchomieniami
(`localStorage`, z awaryjnym powrotem do domyślnego, gdy magazyn przeglądarki zawiedzie).

| skórka | charakter |
|---|---|
| **Neo-brutal** (domyślna) | twarde krawędzie, lity czarny cień, wersaliki |
| **Matrix** | czarne tło, zielony fosfor, monospace, poświata zamiast cienia |
| **Garden** | kwiatowe pastele — róż, bez, masło; krój szeryfowy, miękkie zaokrąglenia |
| **Apple** | jasnoszary minimalizm, cienkie linie, delikatne cienie |
| **Pony** | pastele, grube zaokrąglenia, różowy cień |
| **Nord** | chłodny grafit, przygaszony błękit — spokojny motyw ciemny |
| **Speed Night** | nocny asfalt, neon cyjan i magenta |

Motyw steruje nie tylko kolorem, ale i kształtem: grubością obramowania, zaokrągleniem, cieniem,
krojem pisma, wersalikami i reakcją na kliknięcie. Wszystko siedzi w zmiennych w
[themes.css](src/renderer/themes.css); [styles.css](src/renderer/styles.css) nie zawiera ani jednego
koloru wpisanego wprost. Dodanie skórki to jeden blok zmiennych plus wpis na liście w `App.tsx`.

## Testy

```bash
npm test
```

93 testy w 10 plikach, wszystkie bez sieci: dostawcy podmieniani na lokalne atrapy HTTP, magazyn
plikowy pracuje na katalogu tymczasowym. Testy działają na skompilowanym procesie głównym,
więc `npm test` najpierw go buduje.

| plik | co sprawdza |
|---|---|
| `m1-acceptance.js` | kryteria akceptacji MUST M-1…M-7 |
| `delete-test.js` | usuwanie wersji i rodzin, kosz, granice ścieżek |
| `io-test.js` | import i eksport `.md`, bezstratna pętla |
| `json-test.js`, `json2-test.js` | tolerancyjne wyłuskiwanie JSON-a (znaki sterujące, bloki kodu) |
| `cli-test.js`, `promptfile-test.js` | tryb CLI: stdin, `{promptFile}`, błędy |
| `or-test.js`, `providers-test.js` | trzej dostawcy konwencji OpenAI, nagłówki, błędy |
| `stream-test.js` | strumień SSE, brak strumienia, błąd w środku |

## Zmierzone

| pomiar | wynik |
|---|---|
| zimny skan 1000 wersji z dysku | 387 ms |
| wyszukiwanie przy 1000 wersjach | 1–2 ms (wymóg: <1 s) |
| cały zestaw testów | 93/93 PASS |
| instalator | 79 MB, niepodpisany |
| porównanie modeli (4 zadania × 5 modeli × 2 sędziów) | 22 przebiegi, 74 min, $2,40 |

## Znane ograniczenia

- **Na żywo sprawdzona jest tylko droga przez OpenRouter** — za to gruntownie: 22 przebiegi pełnej
  ścieżki kreatora na pięciu modelach ([porownanie-modeli-wnioski.md](porownanie-modeli-wnioski.md)).
  Anthropic (własny klient SDK), OpenAI i Gemini bezpośrednio oraz CLI mają wyłącznie testy na
  atrapach — pierwsza rozmowa z prawdziwym modelem tymi drogami jest testem, nie formalnością.
- **Podgląd interfejsu w zwykłej przeglądarce nie działa dla kreatora** — poza Electronem nie istnieje
  most `window.agents`, więc komponent się wywraca. Katalog renderuje się poprawnie.
- **Instalator nie jest podpisany** — Windows SmartScreen pokaże ostrzeżenie przy pierwszym uruchomieniu.
  Świadomie zaakceptowane w SCOPE §9 na czas, gdy narzędzie służy tylko autorowi.
- **Indeks w pamięci zamiast SQLite/FTS5** — odstępstwo od zablokowanego stacku, opisane i uzasadnione
  w SCOPE §4, czeka na decyzję product ownera. Próg powrotu do SQLite: skan startowy powyżej ~1 s.
- Brak tagów i szablonów — to backlog COULD.

## Import i eksport .md

| akcja | gdzie | co robi |
|---|---|---|
| **Importuj** | kafla „Nowa rodzina" | wybierasz pliki `.md`/`.txt`; **każdy zakłada osobną rodzinę**, nazwa pliku staje się nazwą rodziny. Można wskazać wiele plików naraz |
| **Eksportuj .md** | przy otwartej wersji | zapisuje samą treść promptu, bez nagłówka metadanych — gotową do wklejenia gdzie indziej |
| **eksport** | przy nazwie rodziny | wszystkie wersje w jednym pliku, każda pod nagłówkiem `## vN`, z oznaczeniem wersji działającej |

Import zdejmuje nagłówek metadanych, jeśli plik go ma — dzięki temu plik wyjęty wprost z katalogu
wraca do niego czysty, bez podwójnego nagłówka. Pętla eksport → import jest bezstratna.

## Usuwanie

W katalogu: przycisk **Usuń tę wersję** przy wybranej wersji, oraz **usuń** przy nazwie rodziny.

Dwie zasady, o których mówi okno potwierdzenia:

- **Wersja zabiera ze sobą potomstwo.** Wersje wywiedzione leżą w podkatalogu rodzica, więc usunięcie v2
  usuwa też v3 wywiedzione z v2. Okno wymienia je z nazwy, zanim cokolwiek zniknie.
- **Nic nie znika na amen.** Pliki trafiają do kosza systemowego, nie są kasowane — pomyłkę przywracasz
  sam, bez aplikacji. Usunięcie ostatniej wersji usuwa całą rodzinę.

Potwierdzenie pokazuje proces główny, nie interfejs — nie da się usunąć niczego z pominięciem pytania.

## Skrypty

| skrypt | co robi |
|---|---|
| `npm run dev` | Vite + Electron, przeładowanie renderera |
| `npm run build` | kompiluje proces główny i buduje renderer |
| `npm start` | build + uruchomienie aplikacji |
| `npm run dist` | instalator NSIS w `release/` |
| `npm run typecheck` | TypeScript bez emisji, oba projekty |
| `npm test` | kompiluje proces główny i uruchamia cały zestaw testów (`tests/`) |
