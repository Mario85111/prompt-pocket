/**
 * Własny serwer (Ollama, LM Studio, vLLM): adres, ostrzeżenia, klucz opcjonalny, lista modeli.
 * Serwer to lokalna atrapa HTTP — nic nie wychodzi do sieci i nie jest potrzebna prawdziwa Ollama.
 */
const http = require('node:http');
const path = require('node:path');
const dist = path.join(__dirname, '../dist-electron');
const ep = require(path.join(dist, 'shared/endpoint.js'));
const { runChatCompletion, listModels } = require(path.join(dist, 'main/chat-completions.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && e !== undefined ? '  -> ' + e : ''}`); };

(async () => {
  /* ---------- adres ---------- */
  const N = ep.normalizeBaseUrl;
  ok('adres: sam host z portem → http + /v1', N('localhost:11434') === 'http://localhost:11434/v1', N('localhost:11434'));
  ok('adres: z /v1 zostaje', N('http://localhost:11434/v1') === 'http://localhost:11434/v1');
  ok('adres: końcowy ukośnik zdjęty', N('http://localhost:11434/v1/') === 'http://localhost:11434/v1');
  ok('adres: wklejony pełny …/chat/completions → baza', N('https://ai.firma.pl/v1/chat/completions') === 'https://ai.firma.pl/v1');
  ok('adres: wklejony …/models → baza', N('http://10.0.0.5:8000/v1/models') === 'http://10.0.0.5:8000/v1');
  ok('adres: własna ścieżka zostaje', N('https://serwer.pl/llm/api') === 'https://serwer.pl/llm/api');
  ok('adres: spacje wokół', N('  http://localhost:1234/v1  ') === 'http://localhost:1234/v1');
  ok('adres: pusty → null', N('') === null && N('   ') === null);
  ok('adres: śmieć → null', N('nie adres!!') === null, N('nie adres!!'));
  ok('adres: inny protokół → null', N('ftp://serwer/v1') === null);
  ok('punkt końcowy czatu', ep.chatCompletionsUrl('localhost:11434') === 'http://localhost:11434/v1/chat/completions');
  ok('punkt końcowy modeli', ep.modelsUrl('http://localhost:1234/v1') === 'http://localhost:1234/v1/models');

  ok('lokalny: localhost', ep.isLocalHost('http://localhost:11434/v1'));
  ok('lokalny: 127.0.0.1', ep.isLocalHost('127.0.0.1:8080'));
  ok('lokalny: serwer w sieci nie jest lokalny', !ep.isLocalHost('http://192.168.1.20:11434/v1'));
  ok('ostrzeżenie: http do innej maszyny', ep.isInsecureRemote('http://192.168.1.20:11434/v1'));
  ok('ostrzeżenie: https do innej maszyny — brak', !ep.isInsecureRemote('https://ai.firma.pl/v1'));
  ok('ostrzeżenie: http na localhost — brak', !ep.isInsecureRemote('http://localhost:11434/v1'));

  /* ---------- atrapa serwera ---------- */
  let last = null;
  let modelsStatus = 200;
  let modelsBody = JSON.stringify({ object: 'list', data: [{ id: 'qwen3:32b' }, { id: 'gemma3:4b' }] });
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      last = { method: req.method, url: req.url, headers: req.headers, body };
      if (req.url === '/v1/models') {
        res.writeHead(modelsStatus, { 'content-type': 'application/json' });
        res.end(modelsBody);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"true}"}}]}\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(8793, '127.0.0.1', r));
  const base = 'http://127.0.0.1:8793/v1';

  const out = await runChatCompletion({
    provider: 'Serwer modelu', endpoint: ep.chatCompletionsUrl(base), apiKey: '', model: 'qwen3:32b',
    system: 'S', user: 'U', timeoutMs: 15 * 60 * 1000,
  });
  ok('czat: odpowiedź ze strumienia złożona', out === '{"ok":true}', out);
  ok('czat: bez klucza nie ma nagłówka Authorization', last.headers.authorization === undefined, last.headers.authorization);
  ok('czat: model i wiadomości w żądaniu', (() => { const b = JSON.parse(last.body); return b.model === 'qwen3:32b' && b.messages[0].content === 'S'; })());

  await runChatCompletion({ provider: 'Serwer modelu', endpoint: ep.chatCompletionsUrl(base), apiKey: ' tajny ', model: 'm', system: 'S', user: 'U' });
  ok('czat: z kluczem — Bearer bez spacji', last.headers.authorization === 'Bearer tajny', last.headers.authorization);

  const models = await listModels(ep.modelsUrl(base), '');
  ok('modele: lista posortowana', JSON.stringify(models) === '["gemma3:4b","qwen3:32b"]', JSON.stringify(models));
  ok('modele: GET bez klucza', last.method === 'GET' && last.headers.authorization === undefined);

  modelsStatus = 401;
  let err = '';
  try { await listModels(ep.modelsUrl(base), ''); } catch (e) { err = e.message; }
  ok('modele: 401 → komunikat o kluczu', /klucz/.test(err), err);

  modelsStatus = 200; modelsBody = '<html>to nie serwer modeli</html>';
  err = '';
  try { await listModels(ep.modelsUrl(base), ''); } catch (e) { err = e.message; }
  ok('modele: nie-JSON → czytelny komunikat', /nie jest serwerem modeli/.test(err), err);

  server.close();
  err = '';
  try { await listModels('http://127.0.0.1:8799/v1/models', ''); } catch (e) { err = e.message; }
  ok('modele: brak serwera → „sprawdź adres i czy serwer działa"', /czy serwer działa/.test(err), err);

  err = '';
  try { await runChatCompletion({ provider: 'Serwer modelu', endpoint: 'http://127.0.0.1:8799/v1/chat/completions', apiKey: '', model: 'm', system: 'S', user: 'U' }); } catch (e) { err = e.message; }
  ok('czat: brak serwera → „Brak połączenia" (agent zamienia to na wskazówkę o Ollamie)', err.startsWith('Brak połączenia'), err);

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n${pass} PASS, ${fail + 1} FAIL`); process.exit(1); });
