let data = '';
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  // udaje CLI, ktore gada od siebie i opakowuje JSON w blok kodu
  console.log('Jasne, oto wynik:');
  console.log('```json');
  console.log(JSON.stringify({
    status: 'gotowe', questions: [], rulesCovered: ['zasada 1: rola'],
    prompt: 'PROMPT ZBUDOWANY Z ' + data.length + ' ZNAKOW WEJSCIA { z nawiasem } i "cudzyslowem"',
  }));
  console.log('```');
  console.log('Daj znac, jesli cos poprawic.');
});
