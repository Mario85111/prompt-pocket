/**
 * Notatka przy wersji, data ostatniego użycia, zmienne {{…}}, porównanie wersji, kopia zapasowa.
 * Wszystko na katalogach tymczasowych — prawdziwy katalog promptów nie jest dotykany.
 */
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const dist = path.join(__dirname, '../dist-electron');
const store = require(path.join(dist, 'main/store.js'));
const backup = require(path.join(dist, 'main/backup.js'));
const { findVars, fillVars } = require(path.join(dist, 'shared/vars.js'));
const { diffLines } = require(path.join(dist, 'shared/diff.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && e !== undefined ? '  -> ' + e : ''}`); };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-feat-'));
  store.setRoot(root); await store.ensureRoot();

  /* ---------- notatka ---------- */
  const fam = await store.createFamily('Notatki');
  const v1 = fam.versions[0];
  await store.saveVersionBody(v1.relPath, 'TRESC');
  const note = 'Dodałem format: JSON\ni "cudzysłowy" # oraz \\ backslash';
  await store.saveVersionNote(v1.relPath, note);
  let list = await store.listFamilies(true);
  let got = list[0].versions[0];
  ok('notatka: wraca bajt w bajt (nowa linia, dwukropek, cudzysłów, #, backslash)', got.note === note, JSON.stringify(got.note));
  ok('notatka: treść wersji nietknięta', got.body === 'TRESC', JSON.stringify(got.body));
  const raw = fs.readFileSync(path.join(root, v1.relPath), 'utf8');
  ok('notatka: nagłówek ma jedną linię na pole (plik czytelny w notatniku)', raw.split('\n').filter((l) => l.startsWith('note:')).length === 1);
  await store.saveVersionNote(v1.relPath, '   ');
  got = (await store.listFamilies(true))[0].versions[0];
  ok('notatka: pusta usuwa pole z nagłówka', got.note === '' && !fs.readFileSync(path.join(root, v1.relPath), 'utf8').includes('note:'));
  const v2 = await store.createVersionFrom(v1.relPath);
  await store.saveVersionNote(v1.relPath, 'notatka rodzica');
  const v2read = (await store.listFamilies(true))[0].versions.find((v) => v.relPath === v2.relPath);
  ok('notatka: nowa wersja nie dziedziczy notatki rodzica', v2read.note === '', JSON.stringify(v2read.note));
  const ef = await store.exportFamily(fam.slug);
  ok('eksport rodziny: notatka jako cytat pod nagłówkiem wersji', ef.content.includes('## v1\n\n> notatka rodzica\n\nTRESC'), JSON.stringify(ef.content.slice(0, 80)));

  /* ---------- ostatnie użycie ---------- */
  const a = await store.createFamily('Alfa');
  const z = await store.createFamily('Zeta');
  list = await store.listFamilies(true);
  ok('użycie: bez użyć kolejność alfabetyczna', list.map((f) => f.title).join(',') === 'Alfa,Notatki,Zeta', list.map((f) => f.title).join(','));
  await store.markUsed(z.versions[0].relPath, new Date('2026-09-01T10:00:00Z'));
  await store.markUsed(v1.relPath, new Date('2026-09-05T10:00:00Z'));
  list = await store.listFamilies(true);
  ok('użycie: używane na górze, od najświeższego', list.map((f) => f.title).join(',') === 'Notatki,Zeta,Alfa', list.map((f) => f.title).join(','));
  ok('użycie: rodzina zna najświeższe użycie', list[0].lastUsedAt === '2026-09-05T10:00:00.000Z', list[0].lastUsedAt);
  ok('użycie: wersja zna swoje użycie', list[0].versions[0].lastUsedAt === '2026-09-05T10:00:00.000Z');
  const bodyBefore = list[0].versions[0].body;
  await store.markUsed(v1.relPath);
  ok('użycie: zapis daty nie zmienia treści', (await store.listFamilies(true))[0].versions[0].body === bodyBefore);
  ok('użycie: nieużywana rodzina ma null', list.find((f) => f.title === 'Alfa').lastUsedAt === null);

  /* ---------- zmienne ---------- */
  const t = 'Napisz {{temat}} po {{ język }} dla {{temat}}; {{zła nazwa!}} i {{}}';
  ok('zmienne: kolejność pierwszego wystąpienia, bez powtórzeń, polskie litery', JSON.stringify(findVars(t)) === '["temat","język"]', JSON.stringify(findVars(t)));
  ok('zmienne: podstawienie wszystkich wystąpień', fillVars(t, { temat: 'X', 'język': 'polsku' }) === 'Napisz X po polsku dla X; {{zła nazwa!}} i {{}}', fillVars(t, { temat: 'X', 'język': 'polsku' }));
  ok('zmienne: brak wartości zostawia zmienną', fillVars('a {{b}} c', {}) === 'a {{b}} c');
  ok('zmienne: pusta wartość to też wartość', fillVars('a {{b}} c', { b: '' }) === 'a  c');
  ok('zmienne: wartość z $ nie psuje podstawienia', fillVars('{{x}}', { x: '$& $1' }) === '$& $1', fillVars('{{x}}', { x: '$& $1' }));
  ok('zmienne: tekst bez zmiennych', findVars('zwykły prompt {nawias}').length === 0);

  /* ---------- porównanie ---------- */
  const d = diffLines('a\nb\nc', 'a\nB\nc\nd');
  const s = d.map((l) => (l.kind === 'same' ? ' ' : l.kind === 'add' ? '+' : '-') + l.text).join('|');
  ok('porównanie: zmieniona linia i dopisana na końcu', s === ' a|-b|+B| c|+d', s);
  ok('porównanie: identyczne treści to same „bez zmian"', diffLines('x\ny', 'x\ny').every((l) => l.kind === 'same'));
  ok('porównanie: CRLF i LF traktowane jednakowo', diffLines('x\r\ny', 'x\ny').every((l) => l.kind === 'same'));

  /* ---------- kopia zapasowa ---------- */
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-kopie-'));
  fs.writeFileSync(path.join(target, 'cudzy-plik.txt'), 'nie ruszać');
  fs.mkdirSync(path.join(target, 'cudzy-folder'));
  fs.writeFileSync(path.join(root, 'smiec.md.tmp-123'), 'x');

  const r1 = await backup.backupNow(root, target, new Date(2026, 8, 1, 12, 0, 0));
  ok('kopia: folder z datą w nazwie', path.basename(r1.path) === 'PromptPocket-kopia-2026-09-01_12-00-00', path.basename(r1.path));
  ok('kopia: pliki wersji skopiowane', fs.existsSync(path.join(r1.path, v1.relPath)));
  ok('kopia: treść zgodna', fs.readFileSync(path.join(r1.path, v1.relPath), 'utf8') === fs.readFileSync(path.join(root, v1.relPath), 'utf8'));
  ok('kopia: pliki tymczasowe zapisu pominięte', !fs.existsSync(path.join(r1.path, 'smiec.md.tmp-123')));
  const r1b = await backup.backupNow(root, target, new Date(2026, 8, 1, 12, 0, 0));
  ok('kopia: ta sama sekunda nie nadpisuje poprzedniej', r1b.path !== r1.path && fs.existsSync(r1.path), path.basename(r1b.path));

  for (let i = 2; i <= 13; i++) await backup.backupNow(root, target, new Date(2026, 8, i, 12, 0, 0));
  const ours = fs.readdirSync(target).filter((n) => n.startsWith('PromptPocket-kopia-')).sort();
  ok(`kopia: zostaje ${backup.KEEP} najnowszych`, ours.length === backup.KEEP, ours.length);
  ok('kopia: najstarsze usunięte, najnowsza jest', !ours.includes('PromptPocket-kopia-2026-09-01_12-00-00') && ours.includes('PromptPocket-kopia-2026-09-13_12-00-00'), ours[0]);
  ok('kopia: cudze pliki i foldery nietknięte', fs.existsSync(path.join(target, 'cudzy-plik.txt')) && fs.existsSync(path.join(target, 'cudzy-folder')));

  let threw = false;
  try { await backup.backupNow(root, path.join(root, 'kopie')); } catch { threw = true; }
  ok('kopia: odmowa, gdy folder kopii jest w katalogu promptów', threw && !fs.existsSync(path.join(root, 'kopie')));

  const now = new Date('2026-09-10T12:00:00Z');
  ok('kopia auto: wyłączona → nie pora', !backup.isDue({ dir: target, auto: false, lastAt: null }, now));
  ok('kopia auto: bez folderu → nie pora', !backup.isDue({ dir: null, auto: true, lastAt: null }, now));
  ok('kopia auto: nigdy nie robiona → pora', backup.isDue({ dir: target, auto: true, lastAt: null }, now));
  ok('kopia auto: 23 h temu → nie pora', !backup.isDue({ dir: target, auto: true, lastAt: '2026-09-09T13:00:00Z' }, now));
  ok('kopia auto: 25 h temu → pora', backup.isDue({ dir: target, auto: true, lastAt: '2026-09-09T11:00:00Z' }, now));
  ok('kopia: rozpoznaje folder w chmurze', backup.isSyncedFolder('C:\\Users\\x\\OneDrive\\Kopie') && !backup.isSyncedFolder('D:\\Kopie'));

  const cfgPath = path.join(target, 'cfg', 'backup.json');
  const empty = await backup.readConfig(cfgPath);
  ok('konfiguracja kopii: brak pliku → wartości domyślne', empty.dir === null && empty.auto === false && empty.lastAt === null);
  await backup.writeConfig(cfgPath, { dir: target, auto: true, lastAt: '2026-09-01T00:00:00Z' });
  const back = await backup.readConfig(cfgPath);
  ok('konfiguracja kopii: zapis i odczyt', back.dir === target && back.auto === true && back.lastAt === '2026-09-01T00:00:00Z');

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n${pass} PASS, ${fail + 1} FAIL`); process.exit(1); });
