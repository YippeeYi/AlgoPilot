import { describe, expect, it } from "vitest";
import { PsqlFrame,parsePsqlRows,psqlDiagnosticState, validateTarget, nativeEnvironment,nativeTargetAssertionSql,attestNativeTarget,PsqlConnection } from "../native/psql";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
describe("native PostgreSQL test safety and SQLSTATE collection", () => {
  const safe = { bin: "/tmp/existing-postgres/bin", directory: "/private/tmp/algopilot-m353-native-ABC123/cluster", home: "/private/tmp/algopilot-m353-native-ABC123/home", port: 54321, database: "m353_0123456789abcdef" };
  it("accepts only a generated temporary target and emits no inherited DB/credential configuration", () => {
    expect(() => validateTarget(safe)).not.toThrow();
    expect(nativeEnvironment(safe)).toEqual({ PATH: "/usr/bin:/bin", HOME: safe.home, TMPDIR: "/private/tmp/algopilot-m353-native-ABC123", LC_ALL: "C", NODE_ENV: "test", PSQLRC: "/dev/null", PGPASSFILE: safe.home+"/pgpass.fixture", PGCONNECT_TIMEOUT: "3", PGAPPNAME: "algopilot-m353-isolated", PGSSLMODE: "disable" });
  });
  it('attestation rejects a wrong directory/database/port/role before work, with only an explicit bootstrap exception',async()=>{
    const expected={database:safe.database,directory:safe.directory,host:'127.0.0.1',port:safe.port,listen:'127.0.0.1',role:'fixture_admin'};
    for(const change of [{database:'postgres'},{directory:'/existing'},{host:'192.0.2.1'},{port:5432},{listen:'*'},{role:'authenticated'}])
      await expect(attestNativeTarget({value:async()=>({...expected,...change})} as unknown as PsqlConnection,safe)).rejects.toThrow();
    expect(await attestNativeTarget({value:async()=>expected} as unknown as PsqlConnection,safe)).toEqual(expected);
    expect(nativeTargetAssertionSql(safe,'postgres')).toContain("current_database()<>'postgres'");
    expect(()=>nativeTargetAssertionSql(safe,'existing')).toThrow('Unsafe bootstrap database');
  });
  it.each([{ database: "postgres" }, { database: "production" }, { directory: "/var/lib/postgresql/cluster" }, { directory: "/private/tmp/algopilot-m353-native-x/../cluster" }, { port: 443 }, { port: NaN }, { home: "/Users/real" }, { bin: "postgres" }])("refuses unsafe target %j", change => {
    expect(() => validateTarget({ ...safe, ...change })).toThrow("Unsafe isolated PostgreSQL target");
  });
  it("reassembles fragmented JSON/state frames without relying on stderr ordering", () => {
    const parser = new PsqlFrame("M353_fixture"); expect(parser.feed('{"cached":')).toBeUndefined();
    expect(parser.feed('true}\nM353_fix')).toBeUndefined();
    expect(parser.feed('ture 00000\n')).toEqual({ code: "00000", lines: ['{"cached":true}'] });
  });
  it('decodes formatted composite JSON rows without confusing newlines or quoted brackets for row boundaries',()=>{
    const data=[{content:'synthetic [brace] "quote"\nline'},{content:'second'}];
    expect(parsePsqlRows([...JSON.stringify(data,null,2).split('\n'),'{"ok":true}','null'])).toEqual([data,{ok:true},null]);
    expect(parsePsqlRows([])).toEqual([]);
  });
  it('rejects incomplete or malformed multiline SQL JSON without returning a successful prefix',()=>{
    expect(()=>parsePsqlRows(['{"ok":true}','[{}'])).toThrow('Incomplete isolated JSON row');
    expect(()=>parsePsqlRows(['{"secret":]'])).toThrow();
  });
  it('extracts only the terminal SQLSTATE, never the five-letter severity label or diagnostic text',()=>{
    expect(psqlDiagnosticState('psql:/synthetic/migration.sql:3: ERROR:  42P07\n')).toBe('42P07');
    expect(psqlDiagnosticState('psql:/synthetic/migration.sql:3: ERROR:  23514\n')).toBe('23514');
    expect(psqlDiagnosticState('ERROR: PRIVATE_SYNTHETIC_CONTENT')).toBeUndefined();
  });
  it.each(["AP004", "AP006", "PT409", "42501", "55P03", "25P02", "22012"])("keeps %s failure visible without exposing diagnostic text", code => {
    expect(new PsqlFrame("M353_fixture").feed(`M353_fixture ${code}\n`)).toEqual({ code, lines: [] });
  });
  it("rejects unbounded or trailing SQL output rather than reporting a partial success", () => {
    expect(() => new PsqlFrame("M353_fixture").feed("x".repeat(1_000_001))).toThrow();
    expect(() => new PsqlFrame("M353_fixture").feed("M353_fixture 00000\nextra\n")).toThrow();
  });
  it.each([
    { enabled: false, args: [], reason: "EXPLICIT_ISOLATION_SWITCH_REQUIRED" },
    { enabled: true, args: [], reason: "LOCAL_POSTGRES_BINARIES_REQUIRED" },
    { enabled: true, args: ["--bin-dir", "relative-path"], reason: "LOCAL_POSTGRES_BINARIES_REQUIRED" },
    { enabled: true, args: ["--bin-dir", "/private/tmp/algopilot-m353-never-existing-bin"], reason: "LOCAL_POSTGRES_BINARIES_UNAVAILABLE" },
  ])("actually runs native preflight and returns BLOCKED, never PASS, for $reason", ({ enabled, args, reason }) => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts/m353-isolated.mjs"), ...args], {
      env: { PATH: "/usr/bin:/bin", HOME: "/private/tmp", NODE_ENV: "test", ...(enabled ? { M353_ALLOW_DATABASE_TESTS: "isolated" } : {}),
        ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}),
        ...(process.env.M353_B3_AUDIT_DIRECTORY ? { M353_B3_AUDIT_DIRECTORY: process.env.M353_B3_AUDIT_DIRECTORY } : {}) },
      encoding: "utf8", timeout: 5000,
    });
    expect(result.status).toBe(2); expect(result.signal).toBeNull();
    const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    expect(report).toMatchObject({ status: "BLOCKED", target: null, migrations: [], regressionExitCode: null });
    expect(report.reason).toContain(reason);
  });
});
