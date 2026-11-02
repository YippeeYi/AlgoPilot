import {it,expect,vi} from 'vitest';
import {serializeSqlRead,type SqlRead} from '../fixtures/generation-sql';
function deferred(){let resolve!:(v:unknown)=>void,reject!:(e:Error)=>void;const promise=new Promise<unknown>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
it('queues whole operations on one backend and recovers after a failed operation',async()=>{
  const held=deferred(),calls:string[]=[];
  const run=serializeSqlRead((async(sql:string)=>{calls.push(sql);return sql==='first'?held.promise:'done';}) as SqlRead);
  const first=run('first'),failed=expect(first).rejects.toThrow('synthetic failure'),second=run('second');
  await Promise.resolve();expect(calls).toEqual(['first']);held.reject(Error('synthetic failure'));await failed;
  expect(await second).toBe('done');expect(calls).toEqual(['first','second']);
});
it('independent backend readers stay concurrent and never share the per-client queue',async()=>{
  const held=deferred(),other=vi.fn(async()=>true);
  const a=serializeSqlRead((async()=>held.promise) as SqlRead),b=serializeSqlRead(other as SqlRead);
  let aFinished=false;const one=a('one').then(()=>{aFinished=true;});
  expect(await b('two')).toBe(true);expect(other).toHaveBeenCalledOnce();expect(aFinished).toBe(false);
  held.resolve(null);await one;expect(aFinished).toBe(true);
});
