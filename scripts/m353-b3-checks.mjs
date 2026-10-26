// Run from the repository root. Only stages tracked source + the five B3 files.
// Child env is constructed from constants; never load/read inherited credentials.
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, copyFile, symlink, readFile, readdir, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

const root = process.cwd();
const temporary = await mkdtemp("/private/tmp/algopilot-b3-checks-");
const workspace = join(temporary, "workspace");
const audits = join(temporary, "audits");
await mkdir(workspace, { mode: 0o700 });
await mkdir(audits, { mode: 0o700 });
const additions = ["scripts/m353-b3-probe.ts", "scripts/m353-b3-offline-guard.cjs", "scripts/m353-b3-checks.mjs", "tests/unit/m353-b3-probe.test.ts", "docs/M353_B3_OFFLINE_VERIFICATION.md"];
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", env: { PATH: "/usr/bin:/bin" } }).split("\0").filter(Boolean);
for (const file of new Set([...tracked, ...additions])) {
  if (/(^|\/)\.env($|\.)/.test(file)) continue;
  const destination = join(workspace, file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(root, file), destination);
}
await symlink(resolve(root, "node_modules"), join(workspace, "node_modules"), "dir");
await mkdir(join(temporary, "home"), { mode: 0o700 });
const env = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(temporary, "home"),
  TMPDIR: temporary, CI: "1", NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `--require=${join(workspace, "scripts/m353-b3-offline-guard.cjs")}`,
  M353_B3_AUDIT_DIRECTORY: audits,
};
const commands = [
  ["lint"], ["typecheck"], ["test", "--", "tests/unit/m353-b3-probe.test.ts"],
  // Preserve every assertion/deadline; avoid contention on the existing 5s PGlite case.
  ["test", "--", "--maxWorkers=1"], ["build"],
];
const results = [];
for (const args of commands) {
  const label = `npm run ${args.join(" ")}`;
  console.log(label);
  const code = await new Promise((done, reject) => {
    const child = spawn("npm", ["run", ...args], { cwd: workspace, env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => done(signal ? 1 : code ?? 1));
  });
  results.push({ command: label, exitCode: code });
}
const files = await readdir(audits);
const incomplete = files.filter(file => file.endsWith(".pending") && !files.includes(file.replace(/\.pending$/, ".json"))).length;
const counters = { networkBlocked: 0, dnsBlocked: 0, credentialReadBlocked: 0, externalHTTP: 0, realDNS: 0, realCredentialReads: 0 };
let invalid = 0;
let completed = 0;
for (const file of files.filter(file => file.endsWith(".json"))) {
  try {
    const row = JSON.parse(await readFile(join(audits, file), "utf8"));
    if (row.version !== "m353-b3-guard/1" || Object.keys(counters).some(key => !Number.isSafeInteger(row[key]) || row[key] < 0)) throw new Error("audit_invalid");
    for (const key of Object.keys(counters)) counters[key] += row[key];
    completed++;
  } catch { invalid++; }
}
const auditValid = incomplete === 0 && invalid === 0 && completed > 0;
const result = { results, guardedRuntimes: completed, auditCollection: { state: auditValid ? "collected" : "collection_failed", incomplete, invalid }, counters: auditValid ? counters : null, boundary: "Offline local checks; no B4, real model, credentials or hosted database validation." };
await writeFile(join(temporary, "checks.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ ...result, artifact: join(temporary, "checks.json") }, null, 2));
if (results.some(row => row.exitCode !== 0) || !auditValid || Object.values(counters).some(count => count !== 0)) process.exitCode = 1;
