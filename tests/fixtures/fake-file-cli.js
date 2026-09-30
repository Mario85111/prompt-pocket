const fs = require('fs');
const p = process.argv[2];
const tresc = fs.readFileSync(p, 'utf8');
console.log(JSON.stringify({
  dlugosc: tresc.length,
  ma_nowe_linie: tresc.includes('\n'),
  ma_cudzyslow: tresc.includes('"'),
  sciezka: p,
}));
