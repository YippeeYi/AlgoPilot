import {it,expect,afterAll} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,mkdir,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {replayFixture} from '../fixtures/m34-replay';
const dirs:string[]=[];
async function inputs(){const d=await mkdtemp(join(tmpdir(),'m34-replay-test-'));dirs.push(d);const v=replayFixture();await mkdir(join(d,'reports'));for(const [file,text]of [['freeze.json',JSON.stringify(v.freeze)],['current.json',JSON.stringify(v.current)],['reports/results.json',JSON.stringify(v.artifact,null,2)+'\n'],['reports/report.md',v.markdown]])await writeFile(join(d,file!),text!);return {d,v};}
const cli=(d:string,out='verified')=>spawnSync(process.execPath,[resolve('scripts/m34-replay.mjs'),join(d,'freeze.json'),join(d,'current.json'),join(d,'reports'),join(d,out)],{encoding:'utf8',env:process.env});
afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true});});
it('runs the native read-only CLI through preparation, freeze, JSON/Markdown and independent recount',async()=>{
 const {d}=await inputs(),raw=await readFile(join(d,'freeze.json'),'utf8'),p=cli(d);expect(p.status).toBe(0);expect(JSON.parse(p.stdout)).toEqual({operation:'m34_replay',written:true,status:'VALID'});
 const result=JSON.parse(await readFile(join(d,'verified/replay.json'),'utf8'));expect(result).toMatchObject({integrity:'PASS',independent:{counts:{paired:1}}});expect((await stat(join(d,'verified'))).mode&0o777).toBe(0o700);expect((await stat(join(d,'verified/replay.json'))).mode&0o777).toBe(0o600);
 expect(await readFile(join(d,'freeze.json'),'utf8')).toBe(raw);expect(cli(d).status).toBe(4);
});
it('different input formatting changes only the raw-byte receipt, not reproducible semantic output',async()=>{
 const {d,v}=await inputs();expect(cli(d,'one').status).toBe(0);await writeFile(join(d,'freeze.json'),JSON.stringify(v.freeze,null,2));v.current.observations.reverse();await writeFile(join(d,'current.json'),JSON.stringify(v.current,null,4));await writeFile(join(d,'reports/results.json'),JSON.stringify(v.artifact));expect(cli(d,'two').status).toBe(0);
 for(const name of ['replay.json','replay.md'])expect(await readFile(join(d,'one',name),'utf8')).toBe(await readFile(join(d,'two',name),'utf8'));
 expect(await readFile(join(d,'one/sources.json'),'utf8')).not.toBe(await readFile(join(d,'two/sources.json'),'utf8'));
});
it('tampered reports produce a private failure artifact and nonzero status',async()=>{
 const {d}=await inputs();await writeFile(join(d,'reports/report.md'),'PRIVATE_MATERIAL_KEY');const p=cli(d);expect(p.status).toBe(3);expect(p.stdout+p.stderr).not.toContain('PRIVATE_MATERIAL_KEY');const r=await readFile(join(d,'verified/replay.json'),'utf8');expect(r).toContain('RESULT_MARKDOWN_MISMATCH');expect(r).not.toContain('PRIVATE_MATERIAL_KEY');
});
it('rejects malformed inputs and symlink inputs without leaking raw values or paths',async()=>{
 const {d}=await inputs();await writeFile(join(d,'current.json'),'{"PRIVATE":"SECRET"');let p=cli(d);expect(p.status).toBe(4);expect(p.stdout+p.stderr).not.toMatch(/PRIVATE|SECRET/);
 await rm(join(d,'current.json'));await symlink(join(d,'freeze.json'),join(d,'current.json'));p=cli(d);expect(p.status).toBe(4);
});
it('rejects invalid UTF-8 instead of silently replacing original bytes',async()=>{const {d}=await inputs();await writeFile(join(d,'current.json'),Buffer.from([0x7b,0x22,0xff,0x22,0x3a,0x31,0x7d]));expect(cli(d).status).toBe(4);});
