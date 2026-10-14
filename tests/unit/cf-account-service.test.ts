import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mutateCfAccount, synchronizeCfAccount } from "@/server/codeforces/account-service";
import { initialCfCursor } from "@/features/learning/cf-cursor";
import type { CfAccountRepository } from "@/server/codeforces/account-repository";
import type { CfAccountState } from "@/lib/validation/cf-account";
import { ApiError } from "@/server/http";
const nonce=randomUUID(),scope=randomUUID();
function fixture() {
    const command=vi.fn().mockImplementation(async (p:Record<string,unknown>)=>p.action==='reserve'?{acquired:true,nonce,scope,handle:'Public_Handle',registrationSeconds:10}:p.action==='slot'?{waitMs:0}:p.action==='plan'?{head:initialCfCursor(randomUUID()),history:initialCfCursor(randomUUID()),pendingFrom:1}:{accepted:true});
    const state=vi.fn().mockResolvedValue({version:'cf-evidence/1',handle:'Public_Handle',revision:1,evidenceRevision:1,enabled:false,ownershipVerified:false,historyInProgress:true} as CfAccountState);
    const repo={command,state} as CfAccountRepository;
    const fetcher=vi.fn().mockImplementation(async(url:string)=>url.includes('user.info')?Response.json({status:'OK',result:[{handle:'Public_Handle',registrationTimeSeconds:10}]}):Response.json({status:'OK',result:[{id:1,creationTimeSeconds:10,problem:{contestId:100,index:'A'},author:{members:[{handle:'Public_Handle'}]},verdict:'OK'}]}));
    const sleep=vi.fn().mockResolvedValue(undefined); return {repo,command,state,fetcher,sleep};
}
describe('bounded account orchestration with injected public HTTP only',()=>{
    it('binds canonical public identity, never sends nonce/registration/private lease to browser result',async()=>{
        const f=fixture();const result=await mutateCfAccount(f.repo,{action:'bind',revision:0,requestId:randomUUID(),handle:'Public_Handle'},f);
        expect(f.command).toHaveBeenCalledWith(expect.objectContaining({action:'bind',handle:'Public_Handle',registrationSeconds:10,scope,nonce}));
        expect(JSON.stringify(result)).not.toContain(nonce);expect(JSON.stringify(result)).not.toContain(scope);expect(result.notice).toContain('尚未验证属于本人');
    });
    it('invalid handle and changed public identity preserve binding and do not enable old account evidence',async()=>{
        const f=fixture();f.fetcher.mockResolvedValue(Response.json({status:'FAILED',comment:'User with handle Public_Handle not found'}));
        await expect(mutateCfAccount(f.repo,{action:'bind',revision:0,requestId:randomUUID(),handle:'Public_Handle'},f)).rejects.toMatchObject({status:422});
        expect(f.fetcher).toHaveBeenCalledTimes(1);expect(f.command).toHaveBeenCalledWith({action:'fail',nonce,scope,errorCode:'invalid_handle'});expect(f.command.mock.calls.some(([v])=>v.action==='bind')).toBe(false);
        const changed=fixture();changed.fetcher.mockResolvedValue(Response.json({status:'OK',result:[{handle:'Public_Handle',registrationTimeSeconds:11}]}));
        await expect(mutateCfAccount(changed.repo,{action:'consent',revision:1,requestId:randomUUID(),enabled:true},changed)).rejects.toMatchObject({status:409});expect(changed.command).toHaveBeenCalledWith({action:'fail',nonce,scope,errorCode:'identity_changed'});
    });
    it('records each bounded batch and retries a lost DB ack with identical ID/data instead of refetching',async()=>{
        const f=fixture();let lost=true;const original=f.command.getMockImplementation()!;f.command.mockImplementation(async(v:Record<string,unknown>)=>{if(v.action==='page'&&lost){lost=false;throw new ApiError(503,'UNKNOWN','lost');}return original(v);});
        await synchronizeCfAccount(f.repo,{revision:1,requestId:randomUUID()},f);
        const pages=f.command.mock.calls.map(([v])=>v).filter(v=>v.action==='page');expect(pages).toHaveLength(4);expect(pages[0]).toEqual(pages[1]);expect(f.fetcher).toHaveBeenCalledTimes(4);expect(pages.map(v=>v.purpose)).toEqual(['head','head','history','pending']);
        expect(f.command).toHaveBeenCalledWith({action:'finish',nonce,scope});
    });
    it('coordinates a fresh shared slot on every retry, bounds HTTP/network failures and preserves earlier success',async()=>{
        const f=fixture();f.fetcher.mockRejectedValue(new Error('SECRET'));await expect(synchronizeCfAccount(f.repo,{revision:1,requestId:randomUUID()},f)).rejects.toMatchObject({status:503});expect(f.fetcher).toHaveBeenCalledTimes(2);expect(f.command.mock.calls.filter(([v])=>v.action==='slot')).toHaveLength(2);expect(f.sleep).toHaveBeenCalledWith(3000);
        for(const response of [()=>new Response('',{status:429}),()=>Response.json({status:'FAILED',comment:'Call limit exceeded'})]){
            const limited=fixture();limited.fetcher.mockImplementation(response);await expect(synchronizeCfAccount(limited.repo,{revision:1,requestId:randomUUID()},limited)).rejects.toMatchObject({status:503});expect(limited.fetcher).toHaveBeenCalledTimes(2);expect(limited.command.mock.calls.filter(([v])=>v.action==='slot')).toHaveLength(2);expect(limited.command).toHaveBeenCalledWith({action:'fail',nonce,scope,errorCode:'rate_limit'});
        }
        const partial=fixture();let count=0;partial.fetcher.mockImplementation(async(url:string)=>{count++;if(count>2)throw new Error('network');return url.includes('user.info')?Response.json({status:'OK',result:[{handle:'Public_Handle',registrationTimeSeconds:10}]}):Response.json({status:'OK',result:[]});});
        await expect(synchronizeCfAccount(partial.repo,{revision:1,requestId:randomUUID()},partial)).rejects.toMatchObject({status:503});expect(partial.command.mock.calls.some(([v])=>v.action==='page'&&v.purpose==='head')).toBe(true);expect(partial.command).toHaveBeenCalledWith({action:'fail',nonce,scope,errorCode:'network'});
    });
    it('busy, completed request replay and bounded time budget never make new upstream requests',async()=>{
        const f=fixture();f.command.mockResolvedValue({acquired:false,replayed:true});const result=await synchronizeCfAccount(f.repo,{revision:1,requestId:randomUUID()},f);expect(f.fetcher).not.toHaveBeenCalled();expect(result.notice).toContain('未重复采集');
        const budget=fixture();let time=0;await expect(synchronizeCfAccount(budget.repo,{revision:1,requestId:randomUUID()},{...budget,now:()=>{time+=80000;return time;}})).rejects.toMatchObject({code:'CF_SYNC_BUDGET'});expect(budget.fetcher).not.toHaveBeenCalled();expect(budget.command).toHaveBeenCalledWith({action:'fail',nonce,scope,errorCode:'budget'});
        const contention=fixture();let elapsed=0;const original=contention.command.getMockImplementation()!;
        contention.command.mockImplementation(async(v:Record<string,unknown>)=>{if(v.action==='slot')elapsed=80000;return original(v);});
        await expect(synchronizeCfAccount(contention.repo,{revision:1,requestId:randomUUID()},{...contention,now:()=>elapsed})).rejects.toMatchObject({code:'CF_SYNC_BUDGET'});expect(contention.fetcher).not.toHaveBeenCalled();
    });
});
