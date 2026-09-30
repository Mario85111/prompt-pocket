const http = require('node:http');
let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && e ? '  -> ' + e : ''}`); };
let mode = 'sse';

const server = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c);
  req.on('end', async () => {
    const parsed = JSON.parse(body);
    if (mode === 'sse') {
      if (!parsed.stream) { res.writeHead(400); res.end('{}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const parts = ['{"stat', 'us":"got', 'owe","questions":[],"prompt":"AAA","rulesCovered":[]}'];
      for (const p of parts) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
        await new Promise(r => setTimeout(r, 30));
      }
      res.write(': komentarz utrzymujacy polaczenie\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    } else if (mode === 'plain') {           // model nie strumieniuje mimo prosby
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }));
    } else {                                  // blad w srodku strumienia
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'czesc' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ error: { message: 'limit kredytu' } })}\n\n`);
      res.end();
    }
  });
});

server.listen(8792, async () => {
  process.env.KATALOG_OPENROUTER_ENDPOINT = 'http://127.0.0.1:8792/api/v1/chat/completions';
  const { runOpenRouter } = require(require('node:path').join(__dirname, '../dist-electron/main/openrouter.js'));

  const postep = [];
  const out = await runOpenRouter('k', 'm', 's', 'u', (n) => postep.push(n));
  ok('strumien sklejony w calosc', out === '{"status":"gotowe","questions":[],"prompt":"AAA","rulesCovered":[]}', out);
  ok('postep raportowany na biezaco', postep.length === 3, JSON.stringify(postep));
  ok('licznik rosnie monotonicznie', postep.every((v, i) => i === 0 || v > postep[i - 1]), JSON.stringify(postep));
  ok('licznik konczy na dlugosci tresci', postep[postep.length - 1] === out.length);

  mode = 'plain';
  const plain = await runOpenRouter('k', 'm', 's', 'u');
  ok('brak strumienia -> czytanie calego ciala', plain === '{"a":1}', plain);

  mode = 'err';
  let msg = '';
  try { await runOpenRouter('k', 'm', 's', 'u'); } catch (e) { msg = e.message; }
  ok('blad w srodku strumienia przerywa z powodem', /limit kredytu/.test(msg), msg);

  server.close();
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
});
