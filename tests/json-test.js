const { extractJson, FormatError } = require(require('node:path').join(__dirname, '../dist-electron/main/cli.js'));
let pass=0,fail=0; const ok=(n,c,e)=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${!c&&e?'  -> '+e:''}`);};

// dokladnie to, na czym wywrocil sie DeepSeek: surowa nowa linia w srodku lancucha
const zly = '{"status":"gotowe","prompt":"ROLA\nJestes analitykiem.\n\nZADANIE\nZrob X.","questions":[]}';
const j = extractJson(zly);
ok('surowe nowe linie w lancuchu nie wywracaja parsowania', j.status==='gotowe');
ok('tresc zachowana z lamaniem linii', j.prompt.includes('\n') && j.prompt.startsWith('ROLA'), JSON.stringify(j.prompt.slice(0,20)));

ok('tabulator tez przechodzi', extractJson('{"a":"x\ty"}').a==='x\ty');
ok('poprawny JSON dalej dziala', extractJson('{"a":1}').a===1);
ok('blok kodu dalej dziala', extractJson('```json\n{"a":2}\n```').a===2);
ok('nawias w tresci nie myli parsera', extractJson('{"a":"{ }","b":3}').b===3);

let e1; try{ extractJson('brak jsona'); }catch(e){ e1=e; }
ok('brak JSON-a to FormatError', e1 instanceof FormatError, String(e1));
let e2; try{ extractJson('{"a": '); }catch(e){ e2=e; }
ok('niedomkniety JSON to FormatError', e2 instanceof FormatError, String(e2));

console.log(`\n${pass} PASS, ${fail} FAIL`); process.exit(fail?1:0);
