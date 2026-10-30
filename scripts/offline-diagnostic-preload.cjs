// Test-only supplement. The unchanged guard always denies BEFORE diagnostic capture.
// Never inspect operation arguments, error text/stack, argv or inherited environment.
const fs = process.getBuiltinModule('fs');
const path = process.getBuiltinModule('path');
const {threadId, isMainThread} = process.getBuiltinModule('worker_threads');
const {getCallSites} = process.getBuiltinModule('util');
const {syncBuiltinESMExports} = process.getBuiltinModule('module');
process.getBuiltinModule('module').createRequire(__filename)('./offline-audit-lifecycle.cjs');
const directory = process.env.M353_B3_AUDIT_DIRECTORY;
const diagnostics = directory + '-diagnostics';
const id = `${process.pid}-${threadId}`;
const write = fs.writeFileSync;
const root = process.cwd() + path.sep;
const phaseName = path.basename(directory);
const phase = /^(probe|lint|typecheck|targeted|test|recommendations|build)$/.test(phaseName) ? phaseName : 'unknown';
fs.mkdirSync(diagnostics, {recursive:true, mode:0o700});
write(path.join(diagnostics, id + '.context.json'), JSON.stringify({
  version:'offline-diagnostic/1', auditRecord:id + '.json', pid:process.pid,
  ppid:process.ppid, threadId, isMainThread, phase, startedNs:process.hrtime.bigint().toString(),
}) + '\n', {flag:'wx', mode:0o600});
let sequence = 0, failed = false;
function sourceName(name) {
  if (typeof name !== 'string') return 'unmapped';
  // V8 reports local ESM frames as file URLs; never retain the URL itself.
  if (name.startsWith('file:///')) name = name.slice(7);
  if (/^node:[a-zA-Z0-9_/-]+$/.test(name)) return name;
  const local = name.startsWith(root) ? name.slice(root.length) : null;
  const dependency = name.includes('/node_modules/') ? 'node_modules/' + name.split('/node_modules/').slice(1).join('/node_modules/') : null;
  const candidate = local ?? dependency;
  return candidate && /^(src|scripts|tests|node_modules)\/[a-zA-Z0-9_@./+-]+\.[cm]?[jt]sx?$/.test(candidate) &&
    !candidate.split('/').some(part => part === '..' || part.startsWith('.')) ? candidate : 'unmapped';
}
function capture(kind, operation) {
  try {
    if (++sequence > 32) throw Error();
    const stack = getCallSites(16, {sourceMap:false}).slice(2).map(frame => ({
      source:sourceName(frame.scriptName),
      line:Number.isSafeInteger(frame.lineNumber) ? frame.lineNumber : 0,
      column:Number.isSafeInteger(frame.columnNumber) ? frame.columnNumber : 0,
    }));
    write(path.join(diagnostics, `${id}.${sequence}.event.json`), JSON.stringify({
      version:'offline-denial/1', auditRecord:id + '.json', sequence, kind, operation,
      monotonicNs:process.hrtime.bigint().toString(), stack,
    }) + '\n', {flag:'wx', mode:0o600});
  } catch { failed = true; }
}
function wrap(module, key, kind, operation) {
  const original = module[key];
  if (typeof original !== 'function') return;
  module[key] = function(...args) {
    try { return original.apply(this, args); }
    catch (error) {
      if (error?.message === 'b3_offline_policy_denied') capture(kind, operation);
      throw error;
    }
  };
}
for (const name of ['http', 'https']) for (const key of ['request', 'get'])
  wrap(process.getBuiltinModule(name), key, 'networkBlocked', name + '.' + key);
const net = process.getBuiltinModule('net');
for (const key of ['connect', 'createConnection']) wrap(net, key, 'networkBlocked', 'net.' + key);
wrap(net.Socket.prototype, 'connect', 'networkBlocked', 'net.Socket.connect');
wrap(process.getBuiltinModule('tls'), 'connect', 'networkBlocked', 'tls.connect');
wrap(globalThis, 'fetch', 'networkBlocked', 'fetch');
const dns = process.getBuiltinModule('dns');
for (const [module, prefix] of [[dns, 'dns'], [dns.promises, 'dns.promises']])
  for (const key of Object.keys(module)) if (key === 'lookup' || key === 'lookupService' || key.startsWith('resolve') || key === 'reverse')
    wrap(module, key, 'dnsBlocked', prefix + '.' + key);
for (const [module, prefix] of [[fs, 'fs'], [process.getBuiltinModule('fs/promises'), 'fs.promises']])
  for (const key of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream'])
    wrap(module, key, 'credentialReadBlocked', prefix + '.' + key);
syncBuiltinESMExports();
process.on('exit', () => { if (failed) { process.stderr.write('offline_diagnostic_incomplete\n'); process.exitCode = 93; } });
