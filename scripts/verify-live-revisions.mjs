// opt-in，有界写入标记测试会话；不得自动提供账户凭据或用于生产破坏性测试。
import { chromium } from "playwright";
import { createInterface } from "node:readline/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { verifyLiveRevisions } from "../tests/live/revisions.mjs";
if (process.env.LIVE_ACCEPTANCE_ALLOW_WRITES !== "dedicated-resources") {
  console.error("拒绝运行：仅为已授权专用测试资源设置 LIVE_ACCEPTANCE_ALLOW_WRITES=dedicated-resources。");
  process.exit(1);
}
const origin = "http://localhost:3000";
const browser = await chromium.launch({headless:false});
const prompt = createInterface({input:process.stdin,output:process.stdout});
try {
  const a = await browser.newContext(), b = await browser.newContext();
  await (await a.newPage()).goto(origin+"/login");
  await prompt.question("请在第一个窗口手动登录专用账号 A，然后在这里按 Enter（不要输入密码）。");
  await (await b.newPage()).goto(origin+"/login");
  await prompt.question("请在第二个窗口手动登录专用账号 B，然后按 Enter（不要输入密码）。");
  const result = await verifyLiveRevisions(a,origin,b);
  await mkdir("test-results",{recursive:true});
  await writeFile("test-results/live-revisions.json",JSON.stringify(result,null,2));
  console.log("真实 HTTP 回归通过。结果：test-results/live-revisions.json；未调用 Gemini，测试会话已暂停并保留。");
} catch {
  console.error("真实 HTTP 回归未通过；不输出原始响应或凭据，请检查脱敏服务端诊断。");
  process.exitCode=1;
} finally { prompt.close(); await browser.close(); }
