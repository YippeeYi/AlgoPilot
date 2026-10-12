// 人工登录的真实浏览器 / 托管 PostgREST 回归。普通 E2E 不会运行本文件。
// 不读取凭据、cookies()、storageState() 或原始响应，不调用 Tutor。
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function verifyLiveRevisions(context, origin, otherContext = null) {
  const url = new URL(origin);
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash);
  const records = [];
  const call = async (client, method, path, data, expected, code) => {
    const start = performance.now();
    const response = await client.request[method](origin + path, {
      ...(data ? {data} : {}), headers: {Origin: origin},
    });
    const body = await response.json();
    records.push({method: method.toUpperCase(), path, status: response.status(), elapsedMs: Math.round(performance.now()-start), ...(code ? {code: body.error?.code === code ? code : "UNEXPECTED"} : {})});
    assert.equal(response.status(), expected);
    if (code) assert.equal(body.error?.code, code);
    return body;
  };
  const {session} = await call(context, "post", "/api/v1/sessions", {
    requestId: randomUUID(), mode: "practice", statementSnapshot: "M2 定向修复验收 · 专用测试会话，不计为解题证据",
  }, 201);
  const path = `/api/v1/sessions/${session.id}`;
  await call(context, "patch", path, {action:"pause",expectedRevision:0}, 200);
  const draft = path + "/thought-draft";
  await call(context, "patch", draft, {content:"验收：新窗口草稿",expectedRevision:0}, 200);
  await call(context, "patch", draft, {content:"验收：旧窗口请求不得覆盖",expectedRevision:0}, 409, "REVISION_CONFLICT");
  const current = await call(context, "get", path, null, 200);
  assert.equal(current.session.thought_revision, 1);
  assert.equal(current.session.thought_draft, "验收：新窗口草稿");
  await call(context, "post", path+"/thoughts", {content:"验收：思路历史",expectedRevision:1,requestId:randomUUID()}, 201);
  // 未登录上下文没有复制认证信息。
  const anonymous = await context.browser().newContext();
  try {
    await call(anonymous,"patch",draft,{content:"x",expectedRevision:2},401,"UNAUTHENTICATED");
  } finally { await anonymous.close(); }
  if (otherContext) {
    const {session: other} = await call(otherContext,"post","/api/v1/sessions",{
      requestId:randomUUID(),mode:"practice",statementSnapshot:"M2 双用户隔离验收 · 专用测试会话",
    },201);
    await call(otherContext,"patch",`/api/v1/sessions/${other.id}`,{action:"pause",expectedRevision:0},200);
    assert.notEqual(session.user_id, other.user_id, "必须使用两个不同专用账户");
    for (const suffix of ["","/thoughts"]) {
      await call(otherContext,"get",path+suffix,null,404,"NOT_FOUND");
      await call(context,"get",`/api/v1/sessions/${other.id}`+suffix,null,404,"NOT_FOUND");
    }
    await call(otherContext,"patch",draft,{content:"cross-user",expectedRevision:2},404,"NOT_FOUND");
    await call(otherContext,"post",path+"/thoughts",{content:"cross-user",expectedRevision:2,requestId:randomUUID()},404,"NOT_FOUND");
  }
  return {sessionId:session.id, records, isolation: otherContext ? "PASS" : "NOT TESTED", realDatabaseOutage:"NOT TESTED", geminiCalls:0};
}
