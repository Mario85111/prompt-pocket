/**
 * Natywna ścieżka Ollamy: wykrywanie, kontekst i schemat w żądaniu, strumień NDJSON, błędy.
 * Ollama to lokalna atrapa HTTP — prawdziwa Ollama nie jest potrzebna.
 */
const http = require('node:http');
const path = require('node:path');
const dist = path.join(__dirname, '../dist-electron');
const ollama = require(path.join(dist, 'main/ollama.js'));
const { nativeRoot } = require(path.join(dist, 'shared/endpoint.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && e !== undefined ? '  -> ' + e : ''}`); };

function serve(port, handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => handler(req, res, body));
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  ok('korzeń: /v1 zdjęte', nativeRoot('http://localhost:11434/v1') === 'http://localhost:11434');
  ok('korzeń: ścieżka proxy zachowana', nativeRoot('https://serwer.pl/ollama/v1') === 'https://serwer.pl/ollama');
  ok('korzeń: śmieć → null', nativeRoot('nie adres!!') === null);

  /* ---------- atrapa Ollamy ---------- */
  let last = null;
  let mode = 'ok';
  const fake = await serve(8794, (req, res, body) => {
    last = { url: req.url, headers: req.headers, body };
    if (req.url === '/api/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"version":"0.35.1"}');
    }
    if (mode === 'error') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"model \\"nie-ma\\" not found"}');
    }
    if (mode === 'midstream') {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"message":{"content":"{\\"a\\""},"done":false}\n');
      return res.end('{"error":"out of memory"}\n');
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    // Linia rozcięta między dwa kawałki — klient musi ją skleić.
    res.write('{"message":{"content":"{\\"ok\\":"},"done":false}\n{"message":{"con');
    setTimeout(() => {
      res.write('tent":"true}"},"done":false}\n');
      res.end('{"message":{"content":""},"done":true}');
    }, 20);
  });
  const root = 'http://127.0.0.1:8794';

  ollama.forgetDetection();
  ok('wykrycie: Ollama rozpoznana po /api/version', (await ollama.isOllama(root)) === true);

  let chunks = [];
  const out = await ollama.runOllamaChat({
    origin: root, model: 'gemma3:4b', system: 'S', user: 'U',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    timeoutMs: 60000, onChunk: (n) => chunks.push(n),
  });
  ok('czat: strumień NDJSON złożony, także z rozciętej linii', out === '{"ok":true}', out);
  ok('czat: postęp raportowany', chunks.length >= 2 && chunks[chunks.length - 1] === out.length, JSON.stringify(chunks));
  const sent = JSON.parse(last.body);
  ok('czat: natywny punkt końcowy /api/chat', last.url === '/api/chat', last.url);
  ok(`czat: kontekst num_ctx = ${ollama.OLLAMA_NUM_CTX}`, sent.options && sent.options.num_ctx === ollama.OLLAMA_NUM_CTX, JSON.stringify(sent.options));
  ok('czat: schemat odpowiedzi w polu format', sent.format && sent.format.required[0] === 'ok', JSON.stringify(sent.format));
  ok('czat: wiadomości systemowa i użytkownika', sent.messages[0].role === 'system' && sent.messages[1].content === 'U');
  ok('czat: bez klucza brak nagłówka Authorization', last.headers.authorization === undefined);

  mode = 'error';
  let err = '';
  try { await ollama.runOllamaChat({ origin: root, model: 'nie-ma', system: 'S', user: 'U', schema: {}, timeoutMs: 60000 }); } catch (e) { err = e.message; }
  ok('błąd: brak modelu → czytelny komunikat z treścią od Ollamy', /404/.test(err) && /not found/.test(err), err);

  mode = 'midstream';
  err = '';
  try { await ollama.runOllamaChat({ origin: root, model: 'm', system: 'S', user: 'U', schema: {}, timeoutMs: 60000 }); } catch (e) { err = e.message; }
  ok('błąd: przerwanie w środku strumienia', /out of memory/.test(err), err);
  fake.close();

  /* ---------- serwer, który nie jest Ollamą ---------- */
  const other = await serve(8795, (req, res) => { res.writeHead(404); res.end('not found'); });
  ok('wykrycie: inny serwer (LM Studio, vLLM) to nie Ollama', (await ollama.isOllama('http://127.0.0.1:8795')) === false);
  other.close();

  /* ---------- Ollama jeszcze wyłączona ---------- */
  const late = 'http://127.0.0.1:8796';
  ok('wykrycie: wyłączony serwer → false', (await ollama.isOllama(late)) === false);
  const lateServer = await serve(8796, (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"version":"1"}'); });
  ok('wykrycie: po włączeniu Ollamy wykryta (brak odpowiedzi nie jest zapamiętany)', (await ollama.isOllama(late)) === true);
  lateServer.close();

  err = '';
  try { await ollama.runOllamaChat({ origin: 'http://127.0.0.1:8797', model: 'm', system: 'S', user: 'U', schema: {}, timeoutMs: 60000 }); } catch (e) { err = e.message; }
  ok('błąd: brak serwera → „Brak połączenia" (agent zamienia to na wskazówkę)', err.startsWith('Brak połączenia'), err);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n${pass} PASS, ${fail + 1} FAIL`); process.exit(1); });
