const path = require('node:path'); const fs = require('node:fs'); const os = require('node:os');
const MOD = require('node:path').join(__dirname, '../dist-electron/main/store.js');
const store = require(MOD);
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? '  -> ' + extra : ''}`); };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'katalog-m1-'));
  store.setRoot(root); await store.ensureRoot();

  /* M-1: hierarchia wersji */
  const fam = await store.createFamily('Audyt UX');
  const v1 = fam.versions[0];
  await store.saveVersionBody(v1.relPath, 'TRESC V1');
  const v2 = await store.createVersionFrom(v1.relPath);
  ok('M-1 v2 lezy w podkatalogu v1', v2.relPath === 'audyt-ux/v1/v2.md', v2.relPath);
  ok('M-1 v2 dziedziczy tresc rodzica', v2.body === 'TRESC V1', JSON.stringify(v2.body));
  ok('M-1 v2 zna rodzica', v2.parentVersionId === v1.id);
  await store.saveVersionBody(v2.relPath, 'TRESC V2');
  const afterEdit = (await store.listFamilies())[0].versions.find(v => v.versionNo === 1);
  ok('M-1 rodzic nietkniety po edycji potomka', afterEdit.body === 'TRESC V1', JSON.stringify(afterEdit.body));
  const v3 = await store.createVersionFrom(v2.relPath);
  ok('M-1 v3 schodzi glebiej', v3.relPath === 'audyt-ux/v1/v2/v3.md', v3.relPath);
  const order = (await store.listFamilies())[0].versions.map(v => v.versionNo).join(',');
  ok('M-1 kolejnosc wg pochodzenia', order === '1,2,3', order);

  /* M-3: wersja dzialajaca, co najwyzej jedna */
  await store.setWorkingVersion(v2.relPath);
  await store.setWorkingVersion(v3.relPath);
  const working = (await store.listFamilies())[0].versions.filter(v => v.working);
  ok('M-3 dokladnie jedna wersja dzialajaca', working.length === 1 && working[0].versionNo === 3,
     JSON.stringify(working.map(v => v.versionNo)));

  /* M-6: indeks odtwarzalny — kasujemy cache i czytamy z dysku */
  const fromDisk = await store.listFamilies(true);
  ok('M-6 pelny odczyt z dysku daje ten sam stan', fromDisk[0].versions.length === 3);
  const rawOnDisk = fs.readFileSync(path.join(root, v3.relPath), 'utf8');
  ok('M-6 plik czytelny: ma tresc i front-matter', rawOnDisk.includes('TRESC V2') && rawOnDisk.includes('working: true'));

  /* M-4: wyszukiwanie + wydajnosc na 1000 wersjach */
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) {
    const f = await store.createFamily(`Rodzina numer ${i}`);
    let parentRel = f.versions[0].relPath;
    await store.saveVersionBody(parentRel, `prompt ${i} wers 1 lorem ipsum dolor sit amet`);
    for (let j = 0; j < 9; j++) {
      const child = await store.createVersionFrom(parentRel);
      await store.saveVersionBody(child.relPath, `prompt ${i} wers ${j + 2} lorem ipsum dolor sit amet`);
      parentRel = child.relPath;
    }
  }
  const total = (await store.listFamilies(true)).reduce((s, f) => s + f.versions.length, 0);
  console.log(`      (wygenerowano ${total} wersji w ${Date.now() - t0} ms)`);

  await store.listFamilies(true);                       // zimny indeks
  const tCold = Date.now(); const h1 = await store.search('wers 7'); const coldMs = Date.now() - tCold;
  const tWarm = Date.now(); const h2 = await store.search('dolor sit'); const warmMs = Date.now() - tWarm;
  ok(`M-4 wyszukiwanie <1s przy ${total} wersjach (zimne ${coldMs} ms, cieple ${warmMs} ms)`, coldMs < 1000 && warmMs < 1000);
  ok('M-4 trafienia sensowne', h1.length === 100 && h2.length >= 1000, `${h1.length} / ${h2.length}`);
  ok('M-4 trafienie ma fragment tresci', Boolean(h1[0].excerpt), JSON.stringify(h1[0] && h1[0].excerpt));
  ok('M-4 brak trafien zwraca pusto', (await store.search('zzz-nie-ma-takiej-frazy')).length === 0);
  ok('M-4 szukanie po tytule rodziny', (await store.search('Rodzina numer 42')).length >= 1);

  /* bezpieczenstwo sciezki */
  let blocked = false;
  try { await store.saveVersionBody('../../poza.md', 'x'); } catch { blocked = true; }
  ok('zapis poza katalogiem zablokowany', blocked);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
