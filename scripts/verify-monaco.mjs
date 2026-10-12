import { readFile, readdir } from "node:fs/promises";

// 验证真实客户端产物，防止仅更新 lockfile 而仍打包 Monaco vendored 旧版。
const chunks = await readdir(".next/static/chunks", { recursive: true });
let patched = false;
let monacoBundled = false;
for (const chunk of chunks.filter((file) => file.endsWith(".js"))) {
  const source = await readFile(`.next/static/chunks/${chunk}`, "utf8");
  if (
    source.includes('version="3.4.15"') ||
    source.includes("version='3.4.15'")
  )
    throw new Error("客户端仍含 DOMPurify 3.4.15，Monaco 安全导入替换未生效。");
  monacoBundled ||= source.includes("monaco-editor");
  patched ||=
    source.includes('version="3.4.16"') || source.includes("version='3.4.16'");
}
if (monacoBundled && !patched) throw new Error("未在客户端产物中验证 DOMPurify 3.4.16。");
process.stdout.write(monacoBundled ? "Monaco sanitizer verification: DOMPurify 3.4.16\n" : "Client verification: no Monaco editor in active bundle; obsolete sanitizer absent\n");
