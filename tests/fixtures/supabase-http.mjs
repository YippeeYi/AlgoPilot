// E2E 专用 HTTP 契约替身。没有真实邮件、Supabase JWT 验签或数据库 RLS。
// 生产应用完全不包含此脚本；真实 SQL/RLS 由独立 PostgreSQL 测试覆盖。
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const users = new Map();
const tokens = new Map();
const sessions = new Map();
const problems = new Map();
const thoughts = new Map();
const metrics = { auth: 0, data: 0 };
const now = () => new Date().toISOString();
function user(email) {
  const entry = {
    id: randomUUID(),
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: now(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: now(),
  };
  users.set(email, entry);
  return entry;
}
user("alice@fixture.test");
user("bob@fixture.test");
function sessionFor(entry) {
  const payload = {
    sub: entry.id,
    aud: "authenticated",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  };
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.fixture-signature`;
  tokens.set(token, entry);
  return {
    access_token: token,
    refresh_token: token,
    expires_in: 3600,
    expires_at: payload.exp,
    token_type: "bearer",
    user: entry,
  };
}
function failure(code, message = "fixture error") {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function owned(id, uid) {
  const row = sessions.get(id);
  if (!row || row.user_id !== uid) failure("P0002");
  return row;
}
function rpc(name, p, uid) {
  if (name === "create_custom_problem") {
    const old = [...problems.values()].find(
      (row) => row.owner_id === uid && row.request_id === p.p_request_id,
    );
    if (old) {
      if (old.title !== p.p_title || old.statement !== p.p_statement)
        failure("40001");
      return [old];
    }
    const row = {
      id: randomUUID(),
      owner_id: uid,
      platform: "custom",
      title: p.p_title,
      statement: p.p_statement,
      rating: null,
      created_at: now(),
      request_id: p.p_request_id,
    };
    problems.set(row.id, row);
    return [row];
  }
  if (name === "create_training_session") {
    const problem = p.p_problem_id ? problems.get(p.p_problem_id) : null;
    if (p.p_problem_id && (!problem || problem.owner_id !== uid))
      failure("P0002");
    const old = [...sessions.values()].find(
      (row) => row.user_id === uid && row.create_request_id === p.p_request_id,
    );
    if (old) return [old];
    const timestamp = now();
    const row = {
      id: randomUUID(),
      user_id: uid,
      problem_id: p.p_problem_id,
      statement_snapshot: p.p_statement ?? problem?.statement ?? "",
      mode: p.p_mode,
      phase: "thinking",
      status: "active",
      started_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
      active_seconds: 0,
      resumed_at: timestamp,
      ended_at: null,
      state_revision: 0,
      code_draft: "",
      code_revision: 0,
      thought_draft: "",
      thought_revision: 0,
      outcome: null,
      create_request_id: p.p_request_id,
    };
    sessions.set(row.id, row);
    return [row];
  }
  const row = owned(p.p_id, uid);
  if (name === "transition_training_session") {
    const target = { pause: "paused", resume: "active", finish: "completed" }[
      p.p_action
    ];
    if (row.status === "completed") {
      if (
        p.p_action === "finish" &&
        row.outcome === (p.p_outcome ?? "not_recorded")
      )
        return [row];
      failure("23514");
    }
    if (row.status === target) return [row];
    if (row.state_revision !== p.p_expected_revision) failure("40001");
    if (row.status === "active")
      row.active_seconds += Math.max(
        0,
        Math.floor((Date.now() - Date.parse(row.resumed_at)) / 1000),
      );
    row.resumed_at = target === "active" ? now() : null;
    row.status = target;
    row.state_revision++;
    row.updated_at = now();
    if (target === "completed") {
      row.ended_at = now();
      row.phase = "finished";
      row.outcome = p.p_outcome ?? "not_recorded";
    }
    return [row];
  }
  if (name === "save_training_draft") {
    if (row.status === "completed") failure("23514");
    const revision = `${p.p_kind}_revision`;
    const draft = `${p.p_kind}_draft`;
    if (
      row[draft] === p.p_content &&
      [p.p_expected_revision, p.p_expected_revision + 1].includes(row[revision])
    )
      return [row];
    if (row[revision] !== p.p_expected_revision) failure("40001");
    row[draft] = p.p_content;
    row[revision]++;
    row.updated_at = now();
    return [row];
  }
  if (name === "append_training_thought") {
    const old = [...thoughts.values()].find(
      (v) => v.session_id === row.id && v.request_id === p.p_request_id,
    );
    if (old) {
      if (old.content !== p.p_content) failure("40001");
      return { session: row, thought: old };
    }
    if (row.status === "completed") failure("23514");
    if (row.thought_revision !== p.p_expected_revision) failure("40001");
    const version = {
      id: randomUUID(),
      session_id: row.id,
      version:
        [...thoughts.values()].filter((v) => v.session_id === row.id).length +
        1,
      content: p.p_content,
      created_at: now(),
      request_id: p.p_request_id,
    };
    thoughts.set(version.id, version);
    row.thought_draft = p.p_content;
    row.thought_revision++;
    return { session: row, thought: version };
  }
  failure("P0002");
}
function select(url, uid) {
  const table = url.pathname.split("/").at(-1);
  let rows =
    table === "training_sessions"
      ? [...sessions.values()].filter((row) => row.user_id === uid)
      : table === "problems"
        ? [...problems.values()].filter((row) => row.owner_id === uid)
        : [...thoughts.values()].filter(
            (row) => sessions.get(row.session_id)?.user_id === uid,
          );
  for (const [key, value] of url.searchParams)
    if (value.startsWith("eq."))
      rows = rows.filter((row) => row[key] === value.slice(3));
  rows.sort((a, b) =>
    table === "thought_snapshots"
      ? b.version - a.version
      : b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
  );
  rows = rows.slice(
    Number(url.searchParams.get("offset") ?? 0),
    Number(url.searchParams.get("offset") ?? 0) +
      Number(url.searchParams.get("limit") ?? 100),
  );
  const fields = url.searchParams.get("select")?.split(",");
  return fields
    ? rows.map((row) =>
        Object.fromEntries(fields.map((field) => [field, row[field]])),
      )
    : rows;
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:54001");
  response.setHeader("Content-Type", "application/json");
  const send = (status, value) => {
    response.statusCode = status;
    response.end(value === undefined ? "" : JSON.stringify(value));
  };
  if (url.pathname === "/health") return send(200, { ready: true });
  if (url.pathname === "/metrics") return send(200, metrics);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString())
    : {};
  const token = request.headers.authorization?.replace(/^Bearer /, "");
  const entry = tokens.get(token);
  try {
    if (url.pathname.startsWith("/auth/")) {
      metrics.auth++;
      if (url.pathname.endsWith("/token")) {
        const target = body.refresh_token
          ? tokens.get(body.refresh_token)
          : users.get(body.email);
        if (
          !target?.email_confirmed_at ||
          (!body.refresh_token && body.password !== "Fixture-password-123")
        )
          return send(400, {
            code: "invalid_credentials",
            msg: "Invalid login credentials",
          });
        return send(200, sessionFor(target));
      }
      if (url.pathname.endsWith("/signup")) {
        const target = user(body.email);
        target.email_confirmed_at = null;
        return send(200, target);
      }
      if (url.pathname.endsWith("/verify")) {
        const target = users.get(body.token_hash.replace("confirm:", ""));
        if (!target) return send(403, { msg: "Invalid confirmation" });
        target.email_confirmed_at = now();
        return send(200, sessionFor(target));
      }
      if (!entry) return send(401, { code: "bad_jwt", msg: "Invalid token" });
      if (url.pathname.endsWith("/user")) return send(200, entry);
      if (url.pathname.endsWith("/logout")) {
        tokens.delete(token);
        return send(204);
      }
    }
    if (url.pathname.startsWith("/rest/")) {
      metrics.data++;
      if (!entry) return send(401, { code: "42501", message: "Unauthorized" });
      if (url.pathname.includes("/rpc/"))
        return send(200, rpc(url.pathname.split("/").at(-1), body, entry.id));
      return send(200, select(url, entry.id));
    }
    send(404, { message: "Not found" });
  } catch (error) {
    send(error.code === "P0002" ? 404 : 400, {
      code: error.code ?? "XX000",
      message: "fixture operation rejected",
    });
  }
});
server.listen(54001, "127.0.0.1");
