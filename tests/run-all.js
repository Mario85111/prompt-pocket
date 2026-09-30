/**
 * Uruchamia cały zestaw testów i sumuje wyniki.
 *
 * Testy działają na skompilowanym procesie głównym (`dist-electron/`), a nie na źródłach,
 * więc przed nimi trzeba wykonać `npm run build:main` — robi to skrypt `npm test`.
 *
 * Nic tu nie dotyka sieci ani prawdziwego katalogu promptów: dostawcy są podmieniani
 * na lokalne atrapy HTTP, a magazyn plikowy pracuje na katalogu tymczasowym.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const pliki = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && f !== 'run-all.js')
  .sort();

let sumaPass = 0;
let sumaFail = 0;
const padlo = [];

for (const plik of pliki) {
  const wynik = spawnSync(process.execPath, [path.join(__dirname, plik)], { encoding: 'utf8' });
  const wyjscie = `${wynik.stdout || ''}${wynik.stderr || ''}`;
  const podsumowanie = wyjscie.trim().split('\n').filter(Boolean).pop() || '';
  const m = podsumowanie.match(/(\d+) PASS, (\d+) FAIL/);

  if (!m) {
    padlo.push(plik);
    console.log(`${plik.padEnd(22)} NIE URUCHOMIŁ SIĘ`);
    console.log(wyjscie.split('\n').slice(0, 4).map((l) => '    ' + l).join('\n'));
    continue;
  }

  sumaPass += Number(m[1]);
  sumaFail += Number(m[2]);
  if (Number(m[2]) > 0) padlo.push(plik);
  console.log(`${plik.padEnd(22)} ${podsumowanie}`);
}

console.log(`\nRAZEM: ${sumaPass} PASS, ${sumaFail} FAIL, plików: ${pliki.length}`);
if (padlo.length) console.log('Do sprawdzenia:', padlo.join(', '));
process.exit(sumaFail > 0 || padlo.length ? 1 : 0);
