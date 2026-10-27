import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}
it("production imports cannot select fixture transports or bypass the shared runtime factory", async () => {
  const source = await Promise.all((await files("src")).filter(file => /\.tsx?$/.test(file)).map(async file => ({ file, text: await readFile(file, "utf8") })));
  for (const row of source) expect(row.text, row.file).not.toMatch(/(?:from\s*["'][^"']*tests\/|createLoopbackFixtureProvider|offlineProvider\()/);
  expect(source.filter(row => /new OpenAICompatibleProvider\(/.test(row.text)).map(row => row.file)).toEqual(["src/server/tutor/runtime-provider.ts"]);
  expect(source.filter(row => /await provider\.complete\(/.test(row.text)).map(row => row.file).sort()).toEqual(["src/server/review/orchestrator.ts", "src/server/tutor/orchestrator.ts"]);
});
it("B3 stays outside application imports and has no live CLI or credentials", async () => {
  for (const file of await files("src")) expect(await readFile(file, "utf8"), file).not.toContain("m353-b3-probe");
  const probe = await readFile("scripts/m353-b3-probe.ts", "utf8");
  expect(probe).not.toMatch(/process\.env|LLM_API_KEY|Bearer /);
});
