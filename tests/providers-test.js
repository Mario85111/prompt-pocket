const http=require('node:http'); let pass=0,fail=0,last=null;
const ok=(n,c,e)=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${!c&&e?'  -> '+e:''}`);};
const server=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{
  last={url:req.url,headers:req.headers,body:JSON.parse(b)};
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}));
});});
server.listen(8793,async()=>{
  const base='http://127.0.0.1:8793';
  process.env.KATALOG_OPENAI_ENDPOINT=base+'/openai/v1/chat/completions';
  process.env.KATALOG_GEMINI_ENDPOINT=base+'/gemini/v1beta/openai/chat/completions';
  process.env.KATALOG_OPENROUTER_ENDPOINT=base+'/or/api/v1/chat/completions';
  const {runChatProvider}=require(require('node:path').join(__dirname, '../dist-electron/main/openrouter.js'));
  const {PROVIDERS}=require(require('node:path').join(__dirname, '../dist-electron/main/providers.js'));

  ok('trzej dostawcy w tabeli', Object.keys(PROVIDERS).join(',')==='openai,gemini,openrouter', Object.keys(PROVIDERS).join(','));

  await runChatProvider('openai','sk-openai','model-a','S','U');
  ok('OpenAI: wlasny adres', last.url==='/openai/v1/chat/completions', last.url);
  ok('OpenAI: Bearer', last.headers.authorization==='Bearer sk-openai');
  ok('OpenAI: bez naglowka OpenRoutera', !last.headers['x-openrouter-title']);

  await runChatProvider('gemini','g-key','gemini-x','S','U');
  ok('Gemini: adres zgodny z konwencja OpenAI', last.url==='/gemini/v1beta/openai/chat/completions', last.url);
  ok('Gemini: Bearer', last.headers.authorization==='Bearer g-key');
  ok('Gemini: model przekazany', last.body.model==='gemini-x');

  await runChatProvider('openrouter','or-key','m','S','U');
  ok('OpenRouter: naglowek identyfikacji zostal', last.headers['x-openrouter-title']==='Prompt Pocket');

  let msg='';
  try{ await runChatProvider('openai','k','  ','S','U'); }catch(e){ msg=e.message; }
  ok('brak modelu -> komunikat z nazwa dostawcy', /OpenAI/.test(msg)&&/platform\.openai\.com/.test(msg), msg);

  msg='';
  try{ await runChatProvider('gemini','k','','S','U'); }catch(e){ msg=e.message; }
  ok('podpowiedz modelu rozna per dostawca', /gemini-3\.8-flash/.test(msg), msg);

  server.close(); console.log(`\n${pass} PASS, ${fail} FAIL`); process.exit(fail?1:0);
});
