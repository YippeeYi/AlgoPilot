// Test harness preload only. Not imported by src/ or any production Provider.
// A durable start lets the collector detect a process killed BEFORE the guard's exit publisher.
const fs=process.getBuiltinModule('fs'),path=process.getBuiltinModule('path');
const {threadId}=process.getBuiltinModule('worker_threads');
const directory=process.env.M353_B3_AUDIT_DIRECTORY;
if(!directory||!path.isAbsolute(directory))throw Error('offline_audit_directory_required');
fs.writeFileSync(path.join(directory,`${process.pid}-${threadId}.started`),JSON.stringify({version:'offline-audit-lifecycle/1',pid:process.pid,threadId})+'\n',{flag:'wx',mode:0o600});
const load=process.getBuiltinModule('module').createRequire(__filename);
load('./m353-b3-offline-guard.cjs');
// Vitest stops forks with SIGTERM. Node's default signal exit skips JS exit listeners,
// and can interrupt the guard's atomic publication. Preserve the signal exit status,
// using the original exit function even when a test framework temporarily replaces it.
const terminate=process.exit.bind(process);
process.once('SIGTERM',()=>terminate(143));
process.once('SIGINT',()=>terminate(130));
