import {it,expect,afterAll} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {studyInput} from '../fixtures/m34-results';
const dirs:string[]=[];
async function directory(){const d=await mkdtemp(join(tmpdir(),'m34-results-test-'));dirs.push(d);return d;}
const run=(input:string,output:string)=>spawnSync(process.execPath,[resolve('scripts/m34-results.ts'),input,output],{encoding:'utf8',env:process.env});
afterAll(async()=>{for(const d of dirs)await rm(d,{recursive:true,force:true});});
it('runs real native-TypeScript CLI: input -> validated pair -> deterministic JSON/Markdown without overwriting input',async()=>{
 const d=await directory(),input=join(d,'synthetic.json'),out=join(d,'out'),raw=JSON.stringify(studyInput());await writeFile(input,raw);
 const p=run(input,out);expect(p.status).toBe(0);expect(JSON.parse(p.stdout)).toEqual({operation:'m34_results',written:true,status:'VALID'});
 const result=JSON.parse(await readFile(join(out,'results.json'),'utf8'));expect(result).toMatchObject({status:'VALID',dataSource:'synthetic',counts:{paired:1}});expect(await readFile(join(out,'report.md'),'utf8')).toContain('SYNTHETIC_NOT_HUMAN_RESEARCH');
 expect(await readFile(input,'utf8')).toBe(raw);expect((await stat(out)).mode&0o777).toBe(0o700);expect((await stat(join(out,'results.json'))).mode&0o777).toBe(0o600);
 const retry=run(input,out);expect(retry.status).toBe(4);expect(await readFile(join(out,'results.json'),'utf8')).toBe(JSON.stringify(result,null,2)+'\n');
});
it('invalid/incomplete data still produces an explicit diagnostic report and distinct nonzero exit code',async()=>{
 const d=await directory(),input=join(d,'invalid.json');await writeFile(input,JSON.stringify({...studyInput(),criteria_version:'bad-private-version'}));const p=run(input,join(d,'invalid-report'));expect(p.status).toBe(3);expect(p.stdout+p.stderr).not.toContain('bad-private-version');expect(JSON.parse(await readFile(join(d,'invalid-report/results.json'),'utf8')).status).toBe('INVALID');
 const v=studyInput();v.observations=[];await writeFile(input,JSON.stringify(v));expect(run(input,join(d,'incomplete-report')).status).toBe(2);
});
it('malformed JSON and unsafe IO return a fixed error without input contents or paths',async()=>{
 const d=await directory(),input=join(d,'SECRET_PATH.json');await writeFile(input,'{"PRIVATE_KEY":"SECRET"');const p=run(input,join(d,'out'));expect(p.status).toBe(4);expect(p.stdout+p.stderr).not.toMatch(/PRIVATE_KEY|SECRET|SECRET_PATH/);
 expect(JSON.parse(p.stderr)).toEqual({operation:'m34_results',written:false,error:'INPUT_OR_OUTPUT_ERROR'});
});
it('two output directories reproduce byte-identical reports from reordered valid observations',async()=>{
 const d=await directory(),input=join(d,'in.json'),v=studyInput();await writeFile(input,JSON.stringify(v));expect(run(input,join(d,'a')).status).toBe(0);v.observations.reverse();await writeFile(input,JSON.stringify(v));expect(run(input,join(d,'b')).status).toBe(0);
 for(const name of ['results.json','report.md'])expect(await readFile(join(d,'a',name),'utf8')).toBe(await readFile(join(d,'b',name),'utf8'));
});
