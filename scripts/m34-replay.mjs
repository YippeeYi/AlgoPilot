// Read-only verification of explicitly supplied local study files; never creates or repairs a freeze.
import {open,mkdir,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareStudy} from './m34-study.ts';
import {inspectStudy,renderStudyReport} from './m34-results.ts';
import {verifyReplay,renderReplay,byteDigest,parseReplayJson} from './m34-replay-core.ts';
async function read(path,limit){const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();if(!s.isFile()||s.size>limit)throw Error('input');return await f.readFile();}finally{await f.close();}}
export async function runReplay(paths){
 const [freezePath,currentPath,reports,destination,...extra]=paths;
 if(!freezePath||!currentPath||!reports||!destination||extra.length||extname(freezePath)!=='.json'||extname(currentPath)!=='.json')throw Error('arguments');
 const bytes={freeze:await read(freezePath,5_000_000),current:await read(currentPath,5_000_000),json:await read(resolve(reports,'results.json'),25_000_000),markdown:await read(resolve(reports,'report.md'),25_000_000)};
 const decode=b=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
 const result=verifyReplay(parseReplayJson(decode(bytes.freeze)),parseReplayJson(decode(bytes.current)),parseReplayJson(decode(bytes.json)),decode(bytes.markdown),{prepareStudy,inspectStudy,renderStudyReport});
 const sources={version:'m34-replay-bytes/1',sha256:Object.fromEntries(Object.entries(bytes).map(([k,b])=>[k,byteDigest(b)])),boundary:'Raw byte hashes are separate from reproducible semantic verification; formatting changes these hashes, not the study calculation.'};
 await mkdir(destination,{mode:0o700});
 for(const [name,content]of [['replay.json',JSON.stringify(result,null,2)+'\n'],['replay.md',renderReplay(result)],['sources.json',JSON.stringify(sources,null,2)+'\n']])await writeFile(resolve(destination,name),content,{flag:'wx',mode:0o600});
 return result.status;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const status=await runReplay(process.argv.slice(2));console.log(JSON.stringify({operation:'m34_replay',written:true,status}));process.exitCode=status==='VALID'?0:status==='INVALID'?3:2;}
 catch{console.error(JSON.stringify({operation:'m34_replay',written:false,error:'INPUT_OR_OUTPUT_ERROR'}));process.exitCode=4;}
}
