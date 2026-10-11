// 真正的 PostgreSQL WASM 引擎执行迁移/RLS；auth.uid 是测试 JWT 上下文替身，不是托管 Supabase。
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

let db: PGlite;
const user = "10000000-0000-4000-8000-000000000009";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;`);
  await db.exec(
    await readFile(
      resolve("supabase/migrations/202610110001_m1_training.sql"),
      "utf8",
    ),
  );
  await db.query(
    "insert into auth.users values ($1, 'extra@example.invalid')",
    [user],
  );
}, 30_000);
afterAll(async () => {
  await db?.close();
});

async function asUser<T>(operation: (tx: PGlite) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [
      user,
    ]);
    return operation(tx as unknown as PGlite);
  });
}
async function newSession() {
  return asUser(
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          "select id from public.create_training_session(null, '', 'practice', gen_random_uuid())",
        )
      ).rows[0]!.id,
  );
}

describe("真实 SQL/RLS（本地 PostgreSQL，非 Supabase 集成）", () => {
  it("执行完整双用户、匿名、私有题面、不可变字段、RPC 权限和计时 SQL 测试", async () => {
    await db.exec(await readFile(resolve("supabase/tests/m1_rls.sql"), "utf8"));
    const result = await db.query<{ count: number }>(
      "select count(*)::int as count from public.training_sessions",
    );
    expect(result.rows[0]?.count).toBe(0);
  }, 20_000);
  it("竞争追加只接受一个同 revision 请求，重试后历史版本仍连续", async () => {
    const id = await newSession();
    const append = (content: string, revision: number) =>
      asUser((tx) =>
        tx.query<{ result: { thought: { version: number } } }>(
          "select public.append_training_thought($1, $2, $3, gen_random_uuid()) as result",
          [id, content, revision],
        ),
      );
    const results = await Promise.allSettled([
      append("first", 0),
      append("other", 0),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      (await append("retry using current revision", 1)).rows[0]?.result.thought
        .version,
    ).toBe(2);
    expect(
      (
        await asUser((tx) =>
          tx.query(
            "select version from public.thought_snapshots where session_id = $1 order by version",
            [id],
          ),
        )
      ).rows,
    ).toEqual([{ version: 1 }, { version: 2 }]);
  });
  it("竞争恢复不重置 resumed_at 或重复增加状态 revision", async () => {
    const id = await newSession();
    await asUser((tx) =>
      tx.query(
        "select public.transition_training_session($1, 'pause', 0, null)",
        [id],
      ),
    );
    const resume = () =>
      asUser((tx) =>
        tx.query<{ resumed_at: Date; state_revision: number }>(
          "select resumed_at, state_revision from public.transition_training_session($1, 'resume', 1, null)",
          [id],
        ),
      );
    const [one, two] = await Promise.all([resume(), resume()]);
    expect(one.rows[0]?.resumed_at).toEqual(two.rows[0]?.resumed_at);
    expect(one.rows[0]?.state_revision).toBe(2);
    expect(two.rows[0]?.state_revision).toBe(2);
  });
  it("无 uid 的 authenticated 角色不能调用可信写入", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(
          "set local role authenticated; select set_config('request.jwt.claim.sub', '', true)",
        );
        await tx.query(
          "select public.create_training_session(null, '', 'practice', gen_random_uuid())",
        );
      }),
    ).rejects.toMatchObject({ code: "28000" });
  });
});
