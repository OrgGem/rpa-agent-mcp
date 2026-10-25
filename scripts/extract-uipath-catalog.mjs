import { EXTENSION_ROOT } from './paths.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import path from 'node:path';

const sourceRoot = EXTENSION_ROOT;
const output = 'work/uipath-extracted.json';
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['start', 'end', 'loc'].includes(key)) continue;
    if (Array.isArray(value)) { for (const item of value) if (item?.type) walk(item, visit); }
    else if (value?.type) walk(value, visit);
  }
}
const keyOf = node => node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? String(node.value) : null;
function members(node, target) {
  const found = new Set();
  function scan(current, root = false) {
    if (!current || typeof current !== 'object') return;
    if (!root && /Function/.test(current.type ?? '')) {
      let shadows = current.params?.some(p => p.type === 'Identifier' && p.name === target) ?? false;
      function bindings(n, top = false) {
        if (!n?.type) return;
        if (!top && /Function/.test(n.type)) return;
        if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === target) shadows = true;
        for (const value of Object.values(n)) {
          if (Array.isArray(value)) value.forEach(v => bindings(v));
          else if (value?.type) bindings(value);
        }
      }
      bindings(current.body, true);
      if (shadows) return;
    }
    if (current.type === 'MemberExpression' && current.object?.type === 'Identifier' && current.object.name === target) {
      const field = current.computed && current.property.type !== 'Literal' ? null : keyOf(current.property);
      if (field) found.add(field);
    }
    for (const value of Object.values(current)) {
      if (Array.isArray(value)) value.forEach(v => { if (v?.type) scan(v); });
      else if (value?.type) scan(value);
    }
  }
  scan(node.body, true);
  return [...found].sort();
}
const bundleText = await readFile(path.join(sourceRoot, 'EmbeddedDriversContainer.js'), 'utf8');
const bundle = parse(bundleText, { ecmaVersion: 'latest', locations: true });
const mainText = await readFile(path.join(sourceRoot, 'BackgroundMain.js'), 'utf8');
const main = parse(mainText, { ecmaVersion: 'latest', locations: true });
const units = [];
const registry = [];
walk(bundle, node => {
  if (node.type === 'FunctionDeclaration' && /^Driver_.*_(BackgroundCode|ContentCode_ExtensionWorld|ContentCode_PageWorld|InjectJsCode)$/.test(node.id?.name ?? '')) units.push(node);
  if (node.type === 'ArrayExpression' && node.elements.length === 2 && node.elements.every(n => n?.type === 'ObjectExpression')) {
    const first = Object.fromEntries(node.elements[0].properties.map(p => [keyOf(p.key), p.value]));
    const second = Object.fromEntries(node.elements[1].properties.map(p => [keyOf(p.key), p.value]));
    if (first.uniqueId && second.backgroundCode) registry.push({
      uniqueId: first.uniqueId.value,
      version: first.detailedVersion.arguments[0].value,
      backgroundFunction: second.backgroundCode.name
    });
  }
});
const drivers = [];
for (const item of registry) {
  const unit = units.find(n => n.id.name === item.backgroundFunction);
  if (!unit) throw new Error('Missing background function ' + item.backgroundFunction);
  const functions = new Map();
  const commandObjects = [];
  const specialRoutes = [];
  const genericRoutes = [];
  const outbound = new Set();
  const interesting = [];
  walk(unit, node => {
    if (node.type === 'FunctionDeclaration') functions.set(node.id.name, node);
    if (node.type === 'VariableDeclarator' && node.init?.type === 'ObjectExpression') {
      if (['g_functionCallMap', 'functionCallMap'].includes(node.id.name)) commandObjects.push(node.init);
      if (/RequestMap|CallMap/.test(node.id.name)) interesting.push({ name: node.id.name, keys: node.init.properties.map(p => keyOf(p.key)) });
    }
    if (node.type === 'AssignmentExpression' && node.right.type === 'ObjectExpression' && ['g_functionCallMap', 'functionCallMap'].includes(keyOf(node.left))) commandObjects.push(node.right);
    if (node.type === 'VariableDeclarator' && node.id?.name === 'g_SpecialRequestHandlers') {
      walk(node.init, assignment => {
        if (assignment.type === 'AssignmentExpression' && assignment.left.type === 'MemberExpression' && assignment.left.computed && assignment.right.type === 'Identifier') specialRoutes.push({ messageId: Number(keyOf(assignment.left.property)), handler: assignment.right.name });
      });
    }
    if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && keyOf(node.left.property) === 'g_callMapping') {
      walk(node.right, assignment => {
        if (assignment.type === 'AssignmentExpression' && assignment.left.type === 'MemberExpression' && assignment.left.computed && assignment.right.type === 'Literal' && typeof assignment.right.value === 'number') genericRoutes.push({ messageId: Number(keyOf(assignment.left.property)), contentCommandId: assignment.right.value });
      });
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && keyOf(node.callee.property) === 'CallFunction' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'g_nativeMsgComm' && typeof node.arguments[0]?.value === 'string') outbound.add(node.arguments[0].value);
  });
  const commands = commandObjects.flatMap(object => object.properties.map(property => {
    const name = keyOf(property.key), handler = keyOf(property.value), fn = functions.get(handler);
    return { name, handler, requestFields: fn?.params[0]?.type === 'Identifier' ? members(fn, fn.params[0].name) : [],
      handlerFound: !!fn, handlerOffset: fn?.start ?? null, handlerLine: fn?.loc.start.line ?? null,
      sourceOffset: property.start, sourceLine: property.loc.start.line };
  }));
  if (commands.length < 20) throw new Error('Suspiciously incomplete command map: ' + item.version);
  for (const route of specialRoutes) {
    const fn = functions.get(route.handler);
    route.requestFields = fn?.params[0]?.type === 'Identifier' ? members(fn, fn.params[0].name) : [];
  }
  const prefix = item.backgroundFunction.replace(/_BackgroundCode$/, '');
  const contentMaps = [];
  for (const content of units.filter(n => n.id.name.startsWith(prefix + '_') && n.id.name !== item.backgroundFunction)) {
    walk(content, node => {
      if (node.type === 'VariableDeclarator' && /RequestMap|requestMap|CallMap/.test(node.id.name) && node.init?.type === 'ObjectExpression') contentMaps.push({ unit: content.id.name, name: node.id.name, keys: node.init.properties.map(p => ({ key: keyOf(p.key), handler: keyOf(p.value) })) });
    });
  }
  drivers.push({ ...item, commands, specialRoutes: specialRoutes.filter(r => Number.isInteger(r.messageId)),
    genericRoutes: genericRoutes.filter(r => Number.isInteger(r.messageId)), outbound: [...outbound].sort(), interesting, contentMaps });
}
const loader = [];
const mainOutbound = new Set();
walk(main, node => {
  if (node.type === 'ClassDeclaration' && node.id.name === 'LoaderWin32') {
    const method = node.body.body.find(m => keyOf(m.key) === 'OnNativeHostMessage');
    walk(method, n => {
      if (n.type === 'BinaryExpression' && n.left.type === 'MemberExpression' && keyOf(n.left.property) === 'functionCall' && typeof n.right.value === 'string') loader.push(n.right.value);
    });
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && ['CallNativeHostFunction', 'CallDriverNativeHostFunction'].includes(keyOf(node.callee.property)) && typeof node.arguments[0]?.value === 'string') mainOutbound.add(node.arguments[0].value);
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && keyOf(node.callee.property) === 'CallFunction' && node.callee.object?.name === 'nativeHostToBackground' && typeof node.arguments[0]?.value === 'string') mainOutbound.add(node.arguments[0].value);
});
const manifest = JSON.parse(await readFile(path.join(sourceRoot, 'manifest.json'), 'utf8'));
const data = {
  generatedAt: new Date().toISOString(), extensionId: 'jfcmnbofjlffnejneillkgbniiidiigd', extensionVersion: manifest.version,
  sources: ['BackgroundMain.js', 'EmbeddedDriversContainer.js', 'BackgroundServiceWorker.js', 'ContentMain.js', 'manifest.json'].map(name => ({ name })),
  scope: 'Named native-to-extension driver dispatch entries across all bundled drivers, GenericRequest routes, LoaderWin32 control calls, and statically named reverse calls to the native host. Internal helper functions are excluded.',
  loaderCommands: [...new Set(loader)].sort(), loaderOutbound: [...mainOutbound].sort(), drivers
};
for (const file of data.sources) file.sha256 = createHash('sha256').update(await readFile(path.join(sourceRoot, file.name))).digest('hex');
await writeFile(output, JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify({ extensionVersion: data.extensionVersion, loader: data.loaderCommands, loaderOutbound: data.loaderOutbound,
  drivers: drivers.map(d => ({ version: d.version, commands: d.commands.length, special: d.specialRoutes.length, generic: d.genericRoutes.length, outbound: d.outbound, contentMaps: d.contentMaps.map(m => ({ name: m.name, count: m.keys.length })) })),
  uniqueNamedCommands: new Set(drivers.flatMap(d => d.commands.map(c => c.name))).size }, null, 2));
