const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const store=require(require('node:path').join(__dirname, '../dist-electron/main/store.js'));
let pass=0,fail=0; const ok=(n,c,e)=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${!c&&e?'  -> '+e:''}`);};

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'katalog-io-'));
  store.setRoot(root); await store.ensureRoot();

  const f=await store.createFamily('Audyt UX');
  const v1=f.versions[0];
  await store.saveVersionBody(v1.relPath,'TRESC V1\nz druga linia');
  const v2=await store.createVersionFrom(v1.relPath);
  await store.saveVersionBody(v2.relPath,'TRESC V2');
  await store.setWorkingVersion(v2.relPath);

  const ev=await store.exportVersion(v2.relPath);
  ok('eksport wersji: nazwa pliku', ev.name==='audyt-ux-v2.md', ev.name);
  ok('eksport wersji: sama tresc, bez naglowka metadanych', ev.content==='TRESC V2' && !ev.content.includes('---'), JSON.stringify(ev.content));

  const ef=await store.exportFamily('audyt-ux');
  ok('eksport rodziny: nazwa pliku', ef.name==='audyt-ux.md', ef.name);
  ok('eksport rodziny: wszystkie wersje', ef.content.includes('TRESC V1')&&ef.content.includes('TRESC V2'));
  ok('eksport rodziny: tytul i naglowki wersji', ef.content.startsWith('# Audyt UX')&&ef.content.includes('## v2 (wersja działająca)'), ef.content.slice(0,60));

  // import zwyklego pliku
  const imp=await store.importAsFamily('Notatka z zewnatrz','# Moj prompt\n\ntresc z pliku');
  ok('import: powstala nowa rodzina', (await store.listFamilies(true)).length===2);
  ok('import: tresc zachowana', imp.body==='# Moj prompt\n\ntresc z pliku', JSON.stringify(imp.body));

  // import naszego wlasnego pliku wersji (z naglowkiem metadanych)
  const surowy=fs.readFileSync(path.join(root,v1.relPath),'utf8');
  const imp2=await store.importAsFamily('Powrot',surowy);
  ok('import pliku z naszym naglowkiem: naglowek zdjety', !imp2.body.includes('familyId') && imp2.body.startsWith('TRESC V1'), JSON.stringify(imp2.body.slice(0,40)));

  // pelna petla eksport -> import
  const back=await store.importAsFamily('Petla', ev.content);
  ok('petla eksport->import bezstratna', back.body==='TRESC V2', JSON.stringify(back.body));

  let threw=false; try{ await store.exportFamily('nie-ma'); }catch{ threw=true; }
  ok('eksport nieistniejacej rodziny to blad', threw);

  fs.rmSync(root,{recursive:true,force:true});
  console.log(`\n${pass} PASS, ${fail} FAIL`); process.exit(fail?1:0);
})();
