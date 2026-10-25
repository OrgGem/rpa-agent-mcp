import { EXTENSION_ROOT } from './paths.mjs';
import { readFile, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = '.';
const extracted = JSON.parse(await readFile('work/uipath-extracted.json', 'utf8'));
const catalog = JSON.parse(await readFile(path.join(root, 'docs/uipath-function-catalog.json'), 'utf8'));
const source = await readFile(EXTENSION_ROOT + '/EmbeddedDriversContainer.js', 'utf8');
const checks = [];
for (const driver of extracted.drivers) {
  const prefix = driver.backgroundFunction.replace(/_BackgroundCode$/, '');
  const start = source.indexOf('function ' + driver.backgroundFunction + '(');
  const end = source.indexOf('function ' + prefix + '_ContentCode_ExtensionWorld(', start);
  assert.ok(start >= 0 && end > start);
  const segment = source.slice(start, end);
  const maps = [...segment.matchAll(/(?:g_)?functionCallMap\s*=\s*\{([^}]+)\}/g)].map(match =>
    [...match[1].matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)/g)].map(pair => pair[1]).sort());
  maps.sort((a,b) => b.length-a.length);
  assert.deepEqual(maps[0], driver.commands.map(command => command.name).sort(), 'Independent map check: ' + driver.version);
  assert.ok(driver.commands.every(command => command.handlerFound));
  assert.equal(new Set(driver.commands.map(command => command.name)).size, driver.commands.length);
  checks.push({ driverVersion: driver.version, namedEntries: driver.commands.length, independentTextMapMatchesAst: true, everyHandlerLocated: true });
}
assert.equal(catalog.functions.length, 88);
assert.equal(new Set(catalog.functions.map(command => command.name)).size, 88);
assert.equal(catalog.loaderFunctions.length, 4);
let localLinkCount = 0;
for (const file of ['README.md', 'docs/UIPATH-EXTENSION-GUIDE.vi.md', 'docs/FUNCTION-MATRIX.vi.md']) {
  const text = await readFile(path.join(root, file), 'utf8');
  assert.ok(!text.includes('\uFFFD'), 'No encoding replacement characters');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^https?:\/\//.test(target) || target.startsWith('#')) continue;
    await access(path.resolve(path.dirname(path.join(root, file)), target.split('#')[0]));
    localLinkCount++;
  }
}
const guide = await readFile(path.join(root, 'docs/UIPATH-EXTENSION-GUIDE.vi.md'), 'utf8');
for (const command of catalog.functions) {
  const needle = '| `' + command.name + '` |';
  assert.equal(guide.split('\n').filter(line => line.startsWith(needle)).length, 1, 'Exactly one catalog row for ' + command.name);
}
const receipt = { checkedAt: new Date().toISOString(), success: true,
  extensionVersion: catalog.extension.version, uniqueNamedDriverEntries: catalog.functions.length,
  loaderEntries: catalog.loaderFunctions.length, versionChecks: checks,
  completeDescriptionCoverage: true, localLinksValidated: localLinkCount,
  scope: 'Static catalog and documentation completeness only. No browser action or new runtime function probe was executed.' };
await writeFile(path.join(root, 'docs/catalog-validation.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
