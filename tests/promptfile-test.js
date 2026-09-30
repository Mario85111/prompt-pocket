const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {runCli}=require(require('node:path').join(__dirname, '../dist-electron/main/cli.js'));
const SP = require('node:path').join(__dirname, 'fixtures').split(require('node:path').sep).join('/');
let pass=0,fail=0; const ok=(n,c,e)=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${!c&&e?'  -> '+e:''}`);};

(async()=>{
  const wielolinijkowy='linia 1 z "cudzyslowem"\nlinia 2 & znaki | specjalne\nlinia 3';
  const out=await runCli({mode:'cli',cliCommand:'node',cliArgs:[`"${SP}/fake-file-cli.js"`,'{promptFile}'],models:{}}, wielolinijkowy);
  const j=JSON.parse(out);
  ok('prompt dotarl plikiem w calosci', j.dlugosc===wielolinijkowy.length, `${j.dlugosc} vs ${wielolinijkowy.length}`);
  ok('nowe linie przetrwaly', j.ma_nowe_linie===true);
  ok('cudzyslowy i znaki specjalne przetrwaly', j.ma_cudzyslow===true);
  ok('plik tymczasowy posprzatany', !fs.existsSync(j.sciezka), j.sciezka);

  // stary tryb (stdin) nadal dziala
  const out2=await runCli({mode:'cli',cliCommand:'node',cliArgs:[`"${SP}/fake-stdin-cli.js"`],models:{}}, 'abc');
  ok('bez {promptFile} nadal idzie przez stdin', JSON.parse(out2).dlugosc===3);

  console.log(`\n${pass} PASS, ${fail} FAIL`); process.exit(fail?1:0);
})();
