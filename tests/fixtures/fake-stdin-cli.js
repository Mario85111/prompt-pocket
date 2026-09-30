let d = '';
process.stdin.on('data', (c) => (d += c));
process.stdin.on('end', () => console.log(JSON.stringify({ dlugosc: d.length })));
