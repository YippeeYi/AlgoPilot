/* Preload only for B3 checks. No request target, env value or exception is logged. */
const fs = process.getBuiltinModule("fs");
const path = process.getBuiltinModule("path");
const { syncBuiltinESMExports } = process.getBuiltinModule("module");
const { threadId } = process.getBuiltinModule("worker_threads");
const auditDirectory = process.env.M353_B3_AUDIT_DIRECTORY;
if (!auditDirectory || !path.isAbsolute(auditDirectory)) throw new Error("b3_audit_directory_required");
const write = fs.writeFileSync;
const audit = { version: "m353-b3-guard/1", networkBlocked: 0, dnsBlocked: 0, credentialReadBlocked: 0, externalHTTP: 0, realDNS: 0, realCredentialReads: 0 };
function deny(kind) {
  return function () {
    audit[kind]++;
    throw new Error("b3_offline_policy_denied");
  };
}
for (const name of ["node:http", "node:https"]) {
  const module = process.getBuiltinModule(name);
  module.request = deny("networkBlocked");
  module.get = deny("networkBlocked");
}
const net = process.getBuiltinModule("net");
net.connect = net.createConnection = net.Socket.prototype.connect = deny("networkBlocked");
process.getBuiltinModule("tls").connect = deny("networkBlocked");
globalThis.fetch = deny("networkBlocked");
const dns = process.getBuiltinModule("dns");
for (const module of [dns, dns.promises]) {
  for (const key of Object.keys(module)) {
    if ((key === "lookup" || key === "lookupService" || key.startsWith("resolve") || key === "reverse") && typeof module[key] === "function") module[key] = deny("dnsBlocked");
  }
}
function credentialPath(value) {
  const name = value instanceof URL ? value.pathname : String(value);
  return /(^|[/\\])\.env($|[./\\])/.test(name) || /(^|[/\\])(\.aws|\.ssh)([/\\]|$)/.test(name);
}
for (const module of [fs, process.getBuiltinModule("fs/promises")]) {
  for (const key of ["readFile", "readFileSync", "open", "openSync", "createReadStream"]) {
    if (typeof module[key] !== "function") continue;
    const original = module[key];
    module[key] = function (file, ...args) {
      if (credentialPath(file)) return deny("credentialReadBlocked")();
      return original.call(this, file, ...args);
    };
  }
}
syncBuiltinESMExports();
process.on("exit", () => {
  const stem = path.join(auditDirectory, `${process.pid}-${threadId}`);
  try {
    // Never publish an empty/partial JSON if a descendant is killed during exit.
    write(`${stem}.pending`, JSON.stringify(audit) + "\n", { flag: "wx", mode: 0o600 });
    fs.linkSync(`${stem}.pending`, `${stem}.json`);
    fs.unlinkSync(`${stem}.pending`);
  } catch {
    process.stderr.write("b3_audit_write_failed\n");
    process.exitCode = 92;
  }
  if (audit.networkBlocked + audit.dnsBlocked + audit.credentialReadBlocked > 0) process.exitCode = 91;
});
