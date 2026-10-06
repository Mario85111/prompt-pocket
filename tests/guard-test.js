/** Zabezpieczenie wersji finalnej audytora przed urwaną odpowiedzią modelu. */
const path = require('node:path');
const { guardFinalPrompt, MIN_FINAL_RATIO } = require(path.join(__dirname, '../dist-electron/shared/audit-guard.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${!c && e !== undefined ? '  -> ' + e : ''}`); };

const audit = (finalPrompt) => ({ verdict: 'luki', gaps: [{ severity: 'istotna', issue: 'x', fix: 'y' }], questions: [], finalPrompt });

// Przypadek zmierzony na modelu lokalnym 12B: szkic 972 znaki, wersja audytora urwana na 470.
const draft = 'a'.repeat(972);
const cut = guardFinalPrompt(draft, audit('b'.repeat(470)));
ok('urwana wersja audytora (470 z 972) → zostaje szkic', cut.finalPrompt === draft);
ok('urwana wersja → wyjaśnienie dla autora z liczbami', /470/.test(cut.keptDraft) && /972/.test(cut.keptDraft), cut.keptDraft);
ok('urwana wersja → uwagi audytora zachowane', cut.gaps.length === 1 && cut.verdict === 'luki');

const fine = guardFinalPrompt(draft, audit('c'.repeat(1200)));
ok('dłuższa wersja audytora → przyjęta bez zmian', fine.finalPrompt.length === 1200 && fine.keptDraft === undefined);

const shorter = guardFinalPrompt(draft, audit('d'.repeat(Math.ceil(972 * MIN_FINAL_RATIO))));
ok(`umiarkowanie krótsza (≥${MIN_FINAL_RATIO * 100}% szkicu) → przyjęta`, shorter.keptDraft === undefined);

const empty = guardFinalPrompt(draft, audit('   '));
ok('pusta wersja audytora → zostaje szkic', empty.finalPrompt === draft && !!empty.keptDraft);

const noDraft = guardFinalPrompt('', audit('cokolwiek'));
ok('pusty szkic → nic nie podmieniamy', noDraft.finalPrompt === 'cokolwiek' && noDraft.keptDraft === undefined);

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
