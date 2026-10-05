// Print the elements on the phone's current screen (type, name, label, position).
// Use it to find what to tap in your scripts.
// Usage: node dump.js [filter]     e.g.  node dump.js giveaway
const wda = require('./wda');

const filter = (process.argv[2] || '').toLowerCase();
const attr = (line, name) => (line.match(new RegExp(` ${name}="([^"]*)"`)) || [])[1] || '';

wda.source().then((src) => {
  const rows = src.split('\n')
    .map((line) => line.match(/^(\s*)<XCUIElementType(\w+)/) && { line, depth: line.search(/\S/) / 2 })
    .filter(Boolean)
    .map(({ line, depth }) => {
      const type = line.match(/XCUIElementType(\w+)/)[1];
      const name = attr(line, 'name'), label = attr(line, 'label'), value = attr(line, 'value');
      const pos = `@${attr(line, 'x')},${attr(line, 'y')} ${attr(line, 'width')}x${attr(line, 'height')}`;
      return { depth, type, text: [name && `name="${name}"`, label && label !== name && `label="${label}"`, value && `value="${value}"`].filter(Boolean).join(' '), pos };
    })
    .filter((r) => r.text || /Cell|Button/.test(r.type))
    .filter((r) => !filter || (r.type + ' ' + r.text).toLowerCase().includes(filter));
  for (const r of rows) console.log(`${'  '.repeat(Math.min(r.depth, 12))}${r.type} ${r.text} ${r.pos}`);
  console.log(`(${rows.length} elements)`);
}).catch((e) => { console.error(e.message); process.exit(1); });
