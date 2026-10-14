import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
export async function catalogRecording() {
 const source=process.env.CF_REAL_RESPONSE_PATH??'tests/fixtures/cf-problemset-20261012.json.gz';
 const bytes=await readFile(source),raw=(source.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8');
 return {source,raw,sha256:createHash('sha256').update(raw).digest('hex')};
}
