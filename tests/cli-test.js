const { runCli, extractJson } = require(require('node:path').join(__dirname, '../dist-electron/main/cli.js'));
const SP = require('node:path').join(__dirname, 'fixtures').split(require('node:path').sep).join('/');
let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && e ? '  -> ' + e : ''}`); };

(async () => {
  const out = await runCli({ mode: 'cli', cliCommand: 'node', cliArgs: [`"${SP}/fake-cli.js"`] }, 'ZADANIE TESTOWE');
  const json = extractJson(out);
  ok('CLI: prompt dotarl na stdin i wrocil wynik', json.prompt.includes('15 ZNAKOW'), json.prompt);
  ok('CLI: JSON wyciagniety mimo gadania wokol i bloku kodu', json.status === 'gotowe');
  ok('CLI: nawiasy i cudzyslowy w tresci nie psuja parsowania', json.prompt.includes('{ z nawiasem }'));

  ok('extractJson: goly JSON', extractJson('{"a":1}').a === 1);
  ok('extractJson: JSON z tekstem przed i po', extractJson('bla {"a":2} bla').a === 2);
  let threw = false;
  try { extractJson('nie ma tu jsona'); } catch { threw = true; }
  ok('extractJson: brak JSON-a to blad, nie cisza', threw);
  threw = false;
  try { extractJson('{"a": 1'); } catch { threw = true; }
  ok('extractJson: niedomkniety JSON to blad', threw);

  let msg = '';
  try {
    await runCli({ mode: 'cli', cliCommand: 'na-pewno-nie-ma-takiego-polecenia-xyz', cliArgs: [] }, 'x');
  } catch (e) { msg = e.message; }
  ok('CLI: brak polecenia daje czytelny komunikat', /nie znalaz|zakończy/i.test(msg), msg);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
