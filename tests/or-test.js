const http = require('node:http');
let pass = 0, fail = 0, lastRequest = null;
const ok = (n, c, e) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && e ? '  -> ' + e : ''}`); };

// atrapa OpenRoutera
let mode = 'ok';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    lastRequest = { headers: req.headers, body: JSON.parse(body), method: req.method, url: req.url };
    if (mode === 'ok') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '```json\n{"status":"gotowe","questions":[],"prompt":"P","rulesCovered":[]}\n```' } }] }));
    } else if (mode === '401') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'No auth credentials found' } }));
    } else if (mode === 'empty') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'model gated' }, choices: [] }));
    } else {
      res.writeHead(500, { 'content-type': 'text/html' });
      res.end('<html>upstream boom</html>');
    }
  });
});

server.listen(8791, async () => {
  process.env.KATALOG_OPENROUTER_ENDPOINT = 'http://127.0.0.1:8791/api/v1/chat/completions';
  const { runOpenRouter } = require(require('node:path').join(__dirname, '../dist-electron/main/openrouter.js'));
  const { extractJson } = require(require('node:path').join(__dirname, '../dist-electron/main/cli.js'));

  const out = await runOpenRouter('sk-or-TESTOWY', 'jakis/model', 'SYSTEM TEKST', 'USER TEKST');
  ok('POST na /api/v1/chat/completions', lastRequest.method === 'POST' && lastRequest.url.endsWith('/chat/completions'), lastRequest.url);
  ok('naglowek Authorization: Bearer', lastRequest.headers.authorization === 'Bearer sk-or-TESTOWY', lastRequest.headers.authorization);
  ok('model przekazany', lastRequest.body.model === 'jakis/model');
  ok('system i user jako osobne wiadomosci', lastRequest.body.messages[0].role === 'system' && lastRequest.body.messages[1].content.includes('USER TEKST'));
  ok('brak naglowka HTTP-Referer', !lastRequest.headers['http-referer']);
  ok('tresc odczytana z choices[0].message.content', out.includes('"status":"gotowe"'));
  ok('JSON wyluskany z bloku kodu', extractJson(out).status === 'gotowe');

  let msg = '';
  mode = '401';
  try { await runOpenRouter('zly', 'jakis/model', 's', 'u'); } catch (e) { msg = e.message; }
  ok('401 -> czytelny komunikat z tresci bledu', /401/.test(msg) && /No auth credentials/.test(msg), msg);

  msg = '';
  mode = 'empty';
  try { await runOpenRouter('k', 'jakis/model', 's', 'u'); } catch (e) { msg = e.message; }
  ok('200 bez tresci -> powod z pola error', /model gated/.test(msg), msg);

  msg = '';
  mode = '500';
  try { await runOpenRouter('k', 'jakis/model', 's', 'u'); } catch (e) { msg = e.message; }
  ok('500 z HTML-em -> nie wywala sie na parsowaniu', /500/.test(msg) && /upstream boom/.test(msg), msg);

  msg = '';
  try { await runOpenRouter('k', '   ', 's', 'u'); } catch (e) { msg = e.message; }
  ok('pusty model -> mowi wprost czego brakuje', /modelu/.test(msg), msg);

  server.close();
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
});
