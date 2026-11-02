// Test-only transport for a freshly created local Supabase stack. Never imported by the app.
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export async function localManifest(directory) {
  if (!isAbsolute(directory) || !directory.startsWith('/private/tmp/algopilot-r2c-')) throw Error('r2c_private_root_required');
  const s = await lstat(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o777) !== 0o700 || s.uid !== process.getuid()) throw Error('r2c_private_mode_required');
  const m = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (m.root !== directory || !/^algopilot-r2c-[a-f0-9]{8}$/.test(m.projectId) || m.network !== m.projectId) throw Error('r2c_target_mismatch');
  const ports = Object.values(m.ports);
  if (ports.length < 8 || new Set(ports).size !== ports.length || ports.some(p => !Number.isInteger(p) || p < 1024 || p > 65535)) throw Error('r2c_ports_invalid');
  return m;
}

export function localGuard(source, ports) {
  const start = source.indexOf('for (const name of ["node:http", "node:https"])');
  const end = source.indexOf('const dns =');
  if (start < 0 || end <= start) throw Error('r2c_guard_source_changed');
  if (!ports.length || ports.some(p => !Number.isInteger(p) || p < 1024 || p > 65535)) throw Error('r2c_ports_invalid');
  const transport = `
const localPorts = new Set(${JSON.stringify(ports)});
function localHost(h) { return ['127.0.0.1','::1','[::1]','localhost'].includes(h); }
function endpoint(host,port) { if (!localHost(host) || !localPorts.has(Number(port))) return deny('networkBlocked')(); }
function httpTarget(input) {
 if(typeof input==='string'||input instanceof URL) { const u=new URL(input); if(u.protocol!=='http:')return deny('networkBlocked')(); endpoint(u.hostname,u.port||80); }
 else { if(input?.protocol && input.protocol!=='http:')return deny('networkBlocked')(); endpoint(input?.hostname??input?.host??'localhost',input?.port??80); }
}
for(const name of ['node:http','node:https']) { const m=process.getBuiltinModule(name); for(const k of ['request','get']) { const original=m[k];m[k]=function(input,...args){httpTarget(input);return original.call(this,input,...args);}; } }
const net=process.getBuiltinModule('net'), connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const a=Array.isArray(args[0])?args[0]:args;const first=a[0];if(typeof first==='object'&&first.path)return deny('networkBlocked')();endpoint(typeof first==='object'?first.host??'localhost':typeof a[1]==='string'?a[1]:'localhost',typeof first==='object'?first.port:first);return connect.apply(this,args);};
process.getBuiltinModule('tls').connect=deny('networkBlocked');
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,...args){httpTarget(typeof input==='object'&&'url' in input?input.url:input);return originalFetch.call(this,input,...args);};
`;
  const lookup = `
function localLookup(host,options) {if(!localHost(host))return deny('dnsBlocked')();const family=host==='::1'||host==='[::1]'||host==='localhost'&&(options===6||options?.family===6)?6:4;return {address:family===6?'::1':'127.0.0.1',family};}
dns.lookup=function(host,options,callback){if(typeof options==='function'){callback=options;options={};}const a=localLookup(host,options);queueMicrotask(()=>options?.all?callback(null,[a]):callback(null,a.address,a.family));};
dns.promises.lookup=async function(host,options){const a=localLookup(host,options);return options?.all?[a]:a;};
`;
  return source.slice(0, start) + transport + source.slice(end).replace('function credentialPath(value) {', lookup + '\nfunction credentialPath(value) {');
}

export async function prepareLocalAudit(root, directory, ports) {
  const guard = join(directory, 'local-guard.cjs');
  await writeFile(guard, localGuard(await readFile(join(root, 'scripts/m353-b3-offline-guard.cjs'), 'utf8'), ports), { mode: 0o600, flag: 'wx' });
  const lifecycle = join(directory, 'local-lifecycle.cjs');
  const source = await readFile(join(root, 'scripts/offline-audit-lifecycle.cjs'), 'utf8');
  if (!source.includes("load('./m353-b3-offline-guard.cjs')")) throw Error('r2c_lifecycle_source_changed');
  await writeFile(lifecycle, source.replace("load('./m353-b3-offline-guard.cjs')", 'load(' + JSON.stringify(guard) + ')'), { mode: 0o600, flag: 'wx' });
  return lifecycle;
}
