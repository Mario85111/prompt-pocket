const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const store=require(require('node:path').join(__dirname, '../dist-electron/main/store.js'));
let pass=0,fail=0; const ok=(n,c,e)=>{c?pass++:fail++;console.log(`${c?'PASS':'FAIL'}  ${n}${!c&&e?'  -> '+e:''}`);};

(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'katalog-del-'));
  store.setRoot(root); await store.ensureRoot();
  const kosz=[];
  store.setRemover(async(p)=>{ kosz.push(path.relative(root,p).split(path.sep).join('/')); fs.rmSync(p,{recursive:true,force:true}); });

  // rodzina: v1 -> v2 -> v3, oraz osobna galaz v4 z v1
  const f=await store.createFamily('Rodzina testowa');
  const v1=f.versions[0];
  const v2=await store.createVersionFrom(v1.relPath);
  const v3=await store.createVersionFrom(v2.relPath);
  const v4=await store.createVersionFrom(v1.relPath);
  ok('uklad startowy: 4 wersje', (await store.listFamilies(true))[0].versions.length===4);

  const plan=await store.planVersionDeletion(v2.relPath);
  ok('plan: v2 zabiera ze soba v3', plan.versions.join(',')==='v2,v3', plan.versions.join(','));
  ok('plan: to nie cala rodzina', plan.wholeFamily===false);
  ok('plan zna tytul rodziny', plan.familyTitle==='Rodzina testowa');

  await store.deleteVersion(v2.relPath);
  const po=(await store.listFamilies(true))[0].versions.map(v=>v.versionNo).sort();
  ok('po usunieciu zostaja v1 i v4', po.join(',')==='1,4', po.join(','));
  ok('v3 zniknal z dysku razem z v2', !fs.existsSync(path.join(root,v3.relPath)));
  ok('wszystko poszlo przez kosz, nie przez kasowanie', kosz.length>0 && kosz.every(p=>p.startsWith('rodzina-testowa')), JSON.stringify(kosz));

  const planAll=await store.planVersionDeletion(v1.relPath);
  ok('plan: v1 to juz cala rodzina', planAll.wholeFamily===true && planAll.versions.length===2, JSON.stringify(planAll));
  await store.deleteVersion(v1.relPath);
  ok('usuniecie ostatniej wersji usuwa rodzine', (await store.listFamilies(true)).length===0);
  ok('folder rodziny zniknal', !fs.existsSync(path.join(root,'rodzina-testowa')));

  // bezpieczenstwo
  let threw=false; try{ await store.deleteFamily('../../cokolwiek'); }catch{ threw=true; }
  ok('usuwanie poza katalogiem zablokowane', threw);
  threw=false; try{ await store.deleteFamily('nie-ma-takiej'); }catch{ threw=true; }
  ok('usuwanie nieistniejacej rodziny to blad, nie cisza', threw);

  fs.rmSync(root,{recursive:true,force:true});
  console.log(`\n${pass} PASS, ${fail} FAIL`); process.exit(fail?1:0);
})();
