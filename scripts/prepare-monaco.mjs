import { copyFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL("../node_modules/monaco-editor/min/vs/assets/", import.meta.url),
);
const target = fileURLToPath(new URL("../public/monaco/", import.meta.url));
await mkdir(target, { recursive: true });
const worker = (await readdir(source)).find((name) =>
  /^editor\.worker-.*\.js$/.test(name),
);
if (!worker) throw new Error("Monaco worker 资源缺失");
await copyFile(source + worker, target + "editor.worker.js");
