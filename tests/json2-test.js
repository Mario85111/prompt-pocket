const { extractJson, FormatError } = require(require('node:path').join(__dirname, '../dist-electron/main/cli.js'));
let pass=0,fail=0; const ok=(n,c,e)=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${!c&&e?'  -> '+e:''}`);};

// realny ksztalt odpowiedzi przy zadaniu o kodzie: prompt zawiera przyklad w Pythonie
const zKodem = [
 '```python',
 'def f(x):',
 '    return x',
 '```',
 '{"status":"gotowe","questions":[],"prompt":"ROLA...","rulesCovered":[]}',
].join('\n');
ok('blok z kodem nie przeslania odpowiedzi', extractJson(zKodem).status==='gotowe');

// odwrotna kolejnosc: JSON w bloku json, a przyklad kodu wczesniej
const odwrotnie = '```python\nprint(1)\n```\n\n```json\n{"a":7}\n```';
ok('blok oznaczony jako json ma pierwszenstwo', extractJson(odwrotnie).a===7);

// JSON zawierajacy w tresci przyklad kodu z nawiasami
const zNawiasami = '{"prompt":"uzyj dict = {\\"a\\": 1} w kodzie","status":"gotowe"}';
ok('nawiasy w tresci nie myla parsera', extractJson(zNawiasami).status==='gotowe');

// stare przypadki dalej dzialaja
ok('goly JSON', extractJson('{"a":1}').a===1);
ok('JSON w bloku json', extractJson('```json\n{"a":2}\n```').a===2);
ok('surowe nowe linie', extractJson('{"p":"linia1\nlinia2"}').p.includes('\n'));
ok('gadanie wokol', extractJson('prosze bardzo: {"a":3} mam nadzieje ze pomoglem').a===3);

let e; try{ extractJson('```python\nprint(1)\n```\nbrak jsona'); }catch(x){ e=x; }
ok('gdy nigdzie nie ma JSON-a -> FormatError', e instanceof FormatError, String(e));

console.log(`\n${pass} PASS, ${fail} FAIL`); process.exit(fail?1:0);
