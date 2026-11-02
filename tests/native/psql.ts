// Test infrastructure only: each instance owns an independent native psql/backend.
// No connection URL, password, .pgpass, .psqlrc, or inherited environment is used.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import assert from "node:assert/strict";

export class SqlStateError extends Error {
  code: string;
  constructor(code: string) { super(`Isolated PostgreSQL SQLSTATE ${code}`); this.code = code; }
}
export const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
// Only actual framed SQLSTATEs; never SQL, rows, passwords or connection strings.
export const nativeSqlStateCounts:Record<string,number>={};
export const psqlDiagnosticState=(text:string)=>text.match(/:\s*([A-Z0-9]{5})\s*$/m)?.[1];
export type NativeTarget = { bin: string; directory: string; port: number; database: string; home: string };
export function validateTarget(target: NativeTarget) {
  if (!Number.isSafeInteger(target.port) || target.port < 1024 || target.port > 65535 ||
      !/^m353_[a-f0-9]{16}$/.test(target.database) || !target.bin.startsWith("/") ||
      !/^\/private\/tmp\/algopilot-m353-native-[^/]+\/cluster$/.test(resolve(target.directory)) ||
      resolve(target.home) !== join(dirname(resolve(target.directory)), "home"))
    throw new Error("Unsafe isolated PostgreSQL target");
}
export function nativeEnvironment(target: NativeTarget) {
  validateTarget(target);
  return { PATH: "/usr/bin:/bin", HOME: target.home, TMPDIR: dirname(target.directory),
    LC_ALL: "C", NODE_ENV: "test" as const, PSQLRC: "/dev/null", PGPASSFILE: join(target.home,"pgpass.fixture"), PGCONNECT_TIMEOUT: "3",
    PGAPPNAME: "algopilot-m353-isolated", PGSSLMODE: "disable" };
}

export function nativeTargetAssertionSql(target:NativeTarget,database=target.database) {
  validateTarget(target);
  if(database!==target.database&&database!=='postgres')throw Error('Unsafe bootstrap database');
  return `do $$ begin if current_database()<>${literal(database)} or current_setting('data_directory')<>${literal(target.directory)}
    or host(inet_server_addr())<>'127.0.0.1' or inet_server_port()<>${target.port}
    or current_setting('listen_addresses')<>'127.0.0.1' or current_user<>'fixture_admin'
    then raise exception 'ISOLATED_TARGET_MISMATCH' using errcode='23514'; end if; end $$`;
}
export async function attestNativeTarget(connection:PsqlConnection,target:NativeTarget) {
  validateTarget(target);
  const value=await connection.value("select json_build_object('database',current_database(),'directory',current_setting('data_directory'),'host',host(inet_server_addr()),'port',inet_server_port(),'listen',current_setting('listen_addresses'),'role',current_user)");
  assert.deepEqual(value,{database:target.database,directory:target.directory,host:'127.0.0.1',port:target.port,listen:'127.0.0.1',role:'fixture_admin'});
  return value;
}

/** Framing is on stdout, including SQLSTATE, so stdout/stderr ordering cannot hide an error. */
export class PsqlFrame {
  private buffer = "";
  private marker: string;
  constructor(marker: string) { this.marker = marker; }
  feed(text: string): { code: string; lines: string[] } | undefined {
    this.buffer += text;
    if (this.buffer.length > 1_000_000) throw Error("Isolated SQL output exceeded limit");
    const match = new RegExp(`(?:^|\\n)${this.marker} ([A-Z0-9]{5})\\r?\\n`).exec(this.buffer);
    if (!match) return;
    if (match.index + match[0].length !== this.buffer.length) throw Error("Unexpected SQL output after frame");
    return { code: match[1]!, lines: this.buffer.slice(0, match.index).split(/\r?\n/).filter(Boolean) };
  }
}

/** PostgreSQL json_agg(composite) can contain formatting newlines inside one row. */
export function parsePsqlRows(lines:string[]):unknown[] {
  const rows:unknown[]=[];let buffer:string[]=[],depth=0,quoted=false,escaped=false;
  for(const line of lines){
    buffer.push(line);
    for(const char of line){
      if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;}
      else if(char==='"')quoted=true;
      else if(char==='['||char==='{')depth++;
      else if(char===']'||char==='}') {if(--depth<0)throw Error('Non-JSON isolated SQL result');}
    }
    if(!depth&&!quoted){try{rows.push(JSON.parse(buffer.join('\n')));}catch{throw Error('Non-JSON isolated SQL result');}buffer=[];}
  }
  if(buffer.length)throw Error('Incomplete isolated JSON row');
  return rows;
}
export class PsqlConnection {
  private child: ChildProcessWithoutNullStreams;
  private pending?: { frame: PsqlFrame; resolve: (rows: unknown[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private closed = false;
  readonly target: NativeTarget;
  readonly role: "fixture_admin" | "authenticated" | "anon";
  constructor(target: NativeTarget, role: "fixture_admin" | "authenticated" | "anon") {
    this.target = target; this.role = role;
    this.child = spawn(join(target.bin, "psql"), ["-X", "-q", "-A", "-t", "-P", "pager=off",
      "-v", "ON_ERROR_STOP=off", "-h", "127.0.0.1", "-p", String(target.port), "-U", role, "-d", target.database],
    { env: nativeEnvironment(target), stdio: "pipe" });
    // Diagnostics can contain SQL inputs. Only the SQLSTATE frame is exposed.
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.fail(Error("Native SQL input closed")));
    this.child.stdout.on("data", chunk => {
      try {
        if (!this.pending) throw Error("Unframed SQL output");
        const result = this.pending.frame.feed(chunk.toString());
        if (!result) return;
        const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer);
        nativeSqlStateCounts[result.code]=(nativeSqlStateCounts[result.code]??0)+1;
        if (result.code !== "00000") pending.reject(new SqlStateError(result.code));
        else {
          try { pending.resolve(parsePsqlRows(result.lines)); }
          catch { pending.reject(Error("Non-JSON isolated SQL result")); }
        }
      } catch { this.fail(Error("Isolated SQL framing failed")); this.child.kill(); }
    });
    this.child.once("error", () => this.fail(Error("Native psql could not start")));
    this.child.once("exit", () => { this.closed = true; this.fail(Error("Native SQL connection closed")); });
  }
  private fail(error: Error) {
    if (!this.pending) return;
    const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer); pending.reject(error);
  }
  query<T = unknown>(sql: string): Promise<T[]> {
    if (this.closed || this.pending || /(?:^|\n)\s*\\/.test(sql))
      return Promise.reject(Error("SQL session closed, busy, or contains a psql command"));
    const marker = "M353_" + randomUUID().replaceAll("-", "");
    return new Promise((resolve, reject) => {
      this.pending = { frame: new PsqlFrame(marker), resolve: rows => resolve(rows as T[]), reject,
        timer: setTimeout(() => { this.fail(Error("Isolated SQL client deadline")); this.child.kill(); }, 10_000) };
      this.child.stdin.write(sql + `;\n\\echo ${marker} :SQLSTATE\n`);
    });
  }
  async value<T = unknown>(sql: string): Promise<T> {
    const rows = await this.query<T>(sql);
    if (rows.length !== 1) throw Error("Expected one isolated SQL value");
    return rows[0]!;
  }
  async close() {
    if (this.closed) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => this.child.kill(), 3000);
      this.child.once("exit", () => { clearTimeout(timer); resolve(); }); this.child.stdin.end("\\q\n");
    });
  }
}

/** ON_ERROR_STOP is essential for multi-statement files: a final COMMIT can mask an earlier SQLSTATE. */
export async function applyMigration(target: NativeTarget, file: string) {
  const workspace = join(dirname(target.directory), "workspace", "supabase", "migrations");
  if (dirname(resolve(file)) !== workspace || !/^\d{12}_.+\.sql$/.test(file.split("/").at(-1)!))
    throw Error("Migration outside private test copy");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(join(target.bin, "psql"), ["-X", "-v", "ON_ERROR_STOP=1","-v","VERBOSITY=sqlstate", "-h", "127.0.0.1", "-p", String(target.port), "-U", "fixture_admin", "-d", target.database, "-c",nativeTargetAssertionSql(target),"-f", file], { env: nativeEnvironment(target), stdio: ['ignore','ignore','pipe'] });
    let diagnostic='';child.stderr?.on('data',chunk=>{if(diagnostic.length<4096)diagnostic+=String(chunk).slice(0,4096-diagnostic.length);});
    child.once("error", () => reject(Error("Isolated migration process unavailable")));
    child.once("close", code => {
      if(code===0){resolve();return;}
      const sqlState=psqlDiagnosticState(diagnostic);
      if(sqlState)nativeSqlStateCounts[sqlState]=(nativeSqlStateCounts[sqlState]??0)+1;
      reject(Object.assign(Error('Isolated migration failed'),sqlState?{code:sqlState}:{}));
    });
  });
}
