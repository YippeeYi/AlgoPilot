import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {nativeCaseCounts} from '../../scripts/native-node-audit';
it('dynamically collects the original 20 and separate 14 increment cases without running native hooks',()=>{
  const env={...process.env};delete env.M353_NATIVE_TARGET;delete env.M353_ALLOW_DATABASE_TESTS;
  const result=spawnSync(process.execPath,[join(process.cwd(),'node_modules/vitest/vitest.mjs'),'list','--config','vitest.native.config.ts','--staticParse=false','--json'],{env,encoding:'utf8',timeout:15000});
  expect(result.status).toBe(0);expect(result.signal).toBeNull();
  const cases=JSON.parse(result.stdout) as {file:string;name:string}[];
  expect(cases.filter(c=>c.file.endsWith('/recovery.native.test.ts'))).toHaveLength(nativeCaseCounts['native-state']);
  expect(cases.filter(c=>c.file.endsWith('/training-feedback.native.test.ts'))).toHaveLength(nativeCaseCounts['native-feedback']);
  expect(cases).toHaveLength(34);
},20000);
