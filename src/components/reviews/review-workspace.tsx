"use client";
import { ProblemPicker } from "@/components/problems/problem-picker";
import {cfKey,cfUrl,type CatalogProblem} from "@/lib/validation/m3";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {useSearchParams} from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TutorMarkdown from "@/components/practice/tutor-markdown";
import { ClientError, requestJson } from "@/lib/api-client";
import { readCodeFile } from "@/features/reviews/import-code";
import { createReviewSchema, reviewSchema, reviewResultSchema, type CodeReview, type ReviewResult, type ReviewAnalysis } from "@/lib/validation/review";
import { isGenerationDenied } from "@/lib/validation/generation";
import {idSchema,sessionSchema,type TrainingSession} from "@/lib/validation/m1";
import {installNavigationGuard} from '@/features/sessions/navigation-guard';
type SnapshotInput=ReturnType<typeof createReviewSchema.parse>&{problemId?:string};
type CollectionState={phase:'loading'|'ready'|'error';message:string};
export function analysisMarkdown(a: ReviewAnalysis) {
    return `## 算法思路\n${a.summary}\n\n## 正确性证明摘要\n${a.correctness}\n\n## 未证明的假设\n${a.assumptions}\n\n## 时间复杂度\n${a.timeComplexity}\n\n## 空间复杂度\n${a.spaceComplexity}\n\n## 代码行分析\n${a.lineAnalysis.map(l => `- 第 ${l.start}–${l.end} 行：${l.analysis}`).join("\n")}\n\n## 潜在缺陷与边界\n${a.risks}\n\n## 实现改进\n${a.improvements}\n\n## 其他思路（可选）\n${a.alternatives || "未提供"}\n\n## 可迁移知识点\n${a.transferableKnowledge}\n\n## 复习问题\n${a.revisionQuestions.map(q => `- ${q}`).join("\n")}\n\n${a.answer ? `## 追问回答\n${a.answer}` : ""}`;
}
export function ReviewWorkspace({ initialSessionId = "", initialReviewId = "" }: {
    initialSessionId?: string;
    initialReviewId?: string;
}) {
    // Native forward can restore a shallow URL whose server-page props still
    // describe /reviews. Read its validated ID, never infer a new generation.
    const search=useSearchParams();
    const rawTarget=search?.get('reviewId')??initialReviewId;
    const target=idSchema.safeParse(rawTarget);
    const requestedReviewId=target.success?target.data:'';
    const invalidTarget=Boolean(rawTarget&&!target.success);
    const [items, setItems] = useState<CodeReview[]>([]);
    const [sessions, setSessions] = useState<TrainingSession[]>([]);
    const [selected, setSelected] = useState<CodeReview | null>(null);
    const [results, setResults] = useState<ReviewResult[]>([]);
    const [configured, setConfigured] = useState(false);
    const [listState,setListState]=useState<CollectionState>({phase:'loading',message:''});
    const [sessionState,setSessionState]=useState<CollectionState>({phase:'loading',message:''});
    const [working, setBusy] = useState(false);
    const [reading,setReading]=useState(false);
    const busy=working||reading;
    const [accessReady,setAccessReady]=useState(false);
    const [accessDenied,setAccessDenied]=useState(false);
    const [recoverId,setRecoverId]=useState(initialReviewId);
    const [error, setError] = useState("");
    const [sessionId, setSessionId] = useState(initialSessionId);
    const [problem,setProblem]=useState<CatalogProblem|null>(null);
    const [url, setUrl] = useState("");
    const [statement, setStatement] = useState("");
    const [submission, setSubmission] = useState("");
    const [code, setCode] = useState("");
    const [source, setSource] = useState<"paste" | "file">("paste");
    const [fileName, setFileName] = useState<string | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [notes, setNotes] = useState("");
    const [question, setQuestion] = useState("");
    // In-memory only: do not persist a private follow-up/code comparison in browser storage.
    const [pendingGeneration, setPendingGeneration] = useState<{
        reviewId: string;
        requestId: string;
        question: string;
    } | null>(null);
    const generationInFlight = useRef(false);
    const operationInFlight=useRef(false);
    const alive=useRef(false),lifecycle=useRef(0),accessEpoch=useRef(0);
    const scope=useRef<{id:string;owner:string;notes:string}|null>(null);
    const pageOwner=useRef<string|null>(null);
    const collectionTasks=useRef<Partial<Record<'reviews'|'sessions',{epoch:number;grant:number}>>>({});
    const detailTask=useRef<{id:string;epoch:number;sequence:number}|null>(null);
    const [createPending,setCreatePending]=useState(false);
    const [notePending,setNotePending]=useState(false);
    const noteAttempt=useRef<{id:string;revision:number;notes:string}|null>(null);
    const attempt = useRef<{
        payload: string;
        id: string;
        input:SnapshotInput;
    } | null>(null);
    const loadSequence = useRef(0);
    const ownLocation=useRef('');
    const formStamp=JSON.stringify({sessionId,problemId:problem?.id??null,url,statement,submission,code,source,fileName,confirmed});
    const formBaseline=useRef(JSON.stringify({sessionId:initialSessionId,problemId:null,url:'',statement:'',submission:'',code:'',source:'paste',fileName:null,confirmed:false}));
    const live=useRef({formStamp,notes,question,pendingGeneration,createPending,notePending,working});
    const readRef=useRef<((id:string,updateUrl?:boolean)=>Promise<void>)|null>(null);
    const collectionsRef=useRef<((kind:'reviews'|'sessions')=>Promise<void>)|null>(null);
    useLayoutEffect(()=>{live.current={formStamp,notes,question,pendingGeneration,createPending,notePending,working};readRef.current=readDetail;collectionsRef.current=readCollection;});
    useEffect(()=>{
        alive.current=true;const epoch=++lifecycle.current;
        operationInFlight.current=false;generationInFlight.current=false;
        const remove=installNavigationGuard(()=>{
            const value=live.current,risks:string[]=[];
            if(value.formStamp!==formBaseline.current)risks.push('未保存的代码、题面或导入选项');
            if(scope.current && value.notes!==scope.current.notes)risks.push('未保存的复盘笔记');
            if(value.question)risks.push('未发送的复盘追问');
            if(value.createPending)risks.push('快照保存尚未确认（UNKNOWN）');
            if(value.notePending)risks.push('笔记保存尚未确认（UNKNOWN）');
            if(value.pendingGeneration)risks.push('生成请求尚未确认（原编号仅在当前页）');
            if(value.working||operationInFlight.current)risks.push('复盘操作进行中');
            return risks;
        },()=>setError('有未保存或未确认的复盘内容；取消离开后仍保留在当前页面，请保存、核对或复制。'));
        const restore=(event:PageTransitionEvent)=>{if(event.persisted&&scope.current)void readRef.current?.(scope.current.id);};
        window.addEventListener('pageshow',restore);
        return()=>{alive.current=false;lifecycle.current=epoch+1;ownLocation.current='';remove();window.removeEventListener('pageshow',restore);};
    },[]);
    useEffect(() => {
        void collectionsRef.current?.('reviews');
        void collectionsRef.current?.('sessions');
    }, []);
    useEffect(() => {
      if (!requestedReviewId) return;
      const internal=ownLocation.current===requestedReviewId;ownLocation.current='';
      if(internal)return;
      void readRef.current?.(requestedReviewId);
    }, [requestedReviewId]);
    function invalidateAccess(e:unknown){
        if(e instanceof ClientError && (e.status===401||e.status===404||(e.status===403&&!isGenerationDenied(e.code)&&e.code!=='CONTEST_AI_DISABLED'))){
            accessEpoch.current++;setAccessDenied(true);setAccessReady(false);setSelected(null);setResults([]);setItems([]);setSessions([]);setConfigured(false);
            setListState({phase:'error',message:e.status===404?'当前记录不存在或不可访问，历史列表需要重新读取；这不表示其他历史已删除。':'身份或权限需要重新核验，历史列表尚不可用。'});
            setSessionState({phase:'error',message:'身份或权限需要重新核验，关联训练列表尚不可用。'});
            ownLocation.current='';
        }
    }
    function claimOwner(owners:string[]){
        const ids=[...new Set(owners)],known=pageOwner.current??scope.current?.owner;
        if(ids.length>1||(known&&ids.some(id=>id!==known)))throw new ClientError(403,'返回记录与本页身份不一致，请重新核验身份。','REVIEW_OWNER_CHANGED');
        if(ids[0])pageOwner.current=ids[0];
    }
    async function readCollection(kind:'reviews'|'sessions'){
        const epoch=lifecycle.current,grant=accessEpoch.current,previous=collectionTasks.current[kind];
        if(previous?.epoch===epoch&&previous.grant===grant)return;
        const task={epoch,grant};collectionTasks.current[kind]=task;
        const update=kind==='reviews'?setListState:setSessionState;
        update({phase:'loading',message:''});
        try{
            const response=await requestJson<unknown>(kind==='reviews'?'/api/v1/reviews':'/api/v1/sessions?limit=50',{timeoutMs:15_000});
            if(!alive.current||epoch!==lifecycle.current||grant!==accessEpoch.current||collectionTasks.current[kind]!==task)return;
            const entries=response&&typeof response==='object'&&'items' in response?response.items:undefined;
            if(kind==='reviews'){
                const parsed=reviewSchema.array().max(100).safeParse(entries);
                if(!parsed.success||new Set(parsed.data.map(row=>row.id)).size!==parsed.data.length)throw new ClientError(502,'历史列表返回格式不正确，未用于恢复；可重试列表或使用已有复盘链接。','REVIEW_LIST_INVALID');
                claimOwner(parsed.data.map(row=>row.user_id));
                setItems(parsed.data);
            }else{
                const parsed=sessionSchema.array().max(50).safeParse(entries);
                if(!parsed.success)throw new ClientError(502,'关联训练列表返回格式不正确。','REVIEW_LIST_INVALID');
                claimOwner(parsed.data.map(row=>row.user_id));setSessions(parsed.data);
            }
            update({phase:'ready',message:''});
        }catch(e){
            if(!alive.current||epoch!==lifecycle.current||grant!==accessEpoch.current||collectionTasks.current[kind]!==task)return;
            if(e instanceof ClientError&&[401,403].includes(e.status))invalidateAccess(e);
            const name=kind==='reviews'?'历史列表':'关联训练列表';
            const message=e instanceof ClientError&&e.status===401?`${name}读取时登录已失效，请重新登录后显式重试。`:
                e instanceof ClientError&&e.status===403?`${name}访问被拒绝，身份或权限需要重新核验。`:
                e instanceof ClientError&&e.code==='REVIEW_LIST_INVALID'?e.message:
                (e instanceof DOMException&&['TimeoutError','AbortError'].includes(e.name))||e instanceof ClientError&&e.status===408?`${name}读取超时，可显式重试；已知复盘链接仍可单独核验。`:
                `${name}暂时不可用；这不表示历史已删除。可重试列表，已有复盘链接仍可单独核验。`;
            update({phase:'error',message});
        }finally{if(collectionTasks.current[kind]===task)delete collectionTasks.current[kind];}
    }
    async function readDetail(id:string,updateUrl=false){
        if(!idSchema.safeParse(id).success)return;
        if(detailTask.current?.id===id&&detailTask.current.epoch===lifecycle.current)return;
        const epoch=lifecycle.current,seq=++loadSequence.current,grant=accessEpoch.current;
        const task={id,epoch,sequence:seq};detailTask.current=task;
        if(!operationInFlight.current){setBusy(false);if(attempt.current)setCreatePending(true);if(noteAttempt.current)setNotePending(true);}
        setRecoverId(id);setReading(true);setAccessReady(false);setError('');
        try{
            const r=await requestJson<{review:CodeReview;results:ReviewResult[];configured:boolean}>(`/api/v1/reviews/${id}`,{timeoutMs:15_000});
            if(!alive.current||epoch!==lifecycle.current||seq!==loadSequence.current||grant!==accessEpoch.current)return;
            const previous=scope.current;
            if(r.review.id!==id || r.results.some(row=>row.review_id!==id) || (previous&&previous.owner!==r.review.user_id))throw new ClientError(403,'复盘归属无法重新核验。');
            claimOwner([r.review.user_id]);
            const same=previous?.id===id;
            if(!same){setNotes(r.review.notes);setQuestion('');setPendingGeneration(null);noteAttempt.current=null;setNotePending(false);}
            else if(!noteAttempt.current && live.current.notes===previous.notes)setNotes(r.review.notes);
            if(noteAttempt.current?.id===id){
                const ticket=noteAttempt.current;
                if(r.review.notes===ticket.notes&&r.review.revision>ticket.revision){setNotes(ticket.notes);noteAttempt.current=null;setNotePending(false);}
                else if(r.review.revision!==ticket.revision){noteAttempt.current=null;setNotePending(false);setError('服务器笔记已变化。本地编辑仍保留，未再次写入；请核对后再明确保存。');}
                else setError('尚未确认笔记保存；可显式重试原保存，仍沿用原 revision，不调用模型。');
            }
            const pending=live.current.pendingGeneration;
            if(pending?.reviewId===id&&r.results.some(row=>row.id===pending.requestId)){setPendingGeneration(null);if(live.current.question===pending.question)setQuestion('');}
            scope.current={id,owner:r.review.user_id,notes:r.review.notes};
            setSelected(r.review);setResults(r.results);setConfigured(r.configured);setAccessDenied(false);setAccessReady(true);
            setItems(old=>old.map(row=>row.id===id?r.review:row));
            // Let App Router copy its own history state and notify useSearchParams.
            // Passing its internal state back skips that notification.
            if(updateUrl){ownLocation.current=id;window.history.replaceState(null,'',`/reviews?reviewId=${id}`);}
        }catch(e){if(alive.current&&epoch===lifecycle.current&&seq===loadSequence.current&&grant===accessEpoch.current){invalidateAccess(e);setError(e instanceof ClientError?e.message:'复盘读取结果尚未确认，请重新核验。');}}
        finally{if(detailTask.current===task)detailTask.current=null;if(alive.current&&epoch===lifecycle.current&&seq===loadSequence.current)setReading(false);}
    }
    async function open(id: string) {
        if (createPending||notePending||pendingGeneration || generationInFlight.current||operationInFlight.current) {
            setError("请先重试上次生成请求，确认结果后再切换复盘。");
            return;
        }
        if (selected && notes !== selected.notes) {
            setError("请先保存用户编辑内容，再切换复盘。");
            return;
        }
        if (selected && selected.id !== id && question) {
            setError("请先发送追问，或复制并清空追问草稿，再切换复盘。");
            return;
        }
        await readDetail(id,true);
    }
    async function create(event?: React.FormEvent,retry=false) {
        event?.preventDefault();
        if(operationInFlight.current||reading||accessDenied)return;
        if (notePending||pendingGeneration || generationInFlight.current || (createPending&&!retry)) {
            setError("请先重试上次生成请求，确认结果后再保存新快照。");
            return;
        }
        operationInFlight.current=true;setBusy(true);const epoch=lifecycle.current,seq=loadSequence.current,grant=accessEpoch.current;
        setError("");
        try {
            if (!confirmed)
                throw new Error("请明确确认自报 AC 与 Provider 数据发送授权。");
            if (selected && notes !== selected.notes)
                throw new Error("请先保存用户编辑内容。");
            if (selected && question)
                throw new Error("请先发送追问，或复制并清空追问草稿，再保存新快照。");
            if(!sessionId&&!problem)throw new Error("请先选择 Codeforces 题目，或关联已有训练。");
            const body = { sessionId: sessionId || null, code, source, fileName, problemUrl: url, statement, submissionId: submission || null, confirmation: "我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘" as const };
            const payload = JSON.stringify({...body,problemId:problem?.id??null});
            const requestId=attempt.current?.payload===payload?attempt.current.id:crypto.randomUUID();
            const input = createReviewSchema.safeParse({ ...body, requestId });
            if (!input.success)
                throw new Error("代码、文件来源、题目 URL 或提交 ID 格式不正确。仅接受 Codeforces 官方 HTTPS 题目链接及最多 64 KB 的 UTF-8 文本。");
            if(!retry)attempt.current={payload,id:requestId,input:{...input.data,...(problem?{problemId:problem.id}:{})}};
            const r = await requestJson<{
                review: CodeReview;
            }>("/api/v1/reviews", { method: "POST", body: attempt.current!.input,timeoutMs:15_000 });
            if(!alive.current||epoch!==lifecycle.current||seq!==loadSequence.current||grant!==accessEpoch.current)return;
            if(scope.current&&r.review.user_id!==scope.current.owner)throw new ClientError(403,'复盘归属无法重新核验。');
            claimOwner([r.review.user_id]);
            setItems(old => [r.review, ...old.filter(x => x.id !== r.review.id)]);
            setCode("");
            setConfirmed(false);
            setSource('paste');setFileName(null);
            formBaseline.current=JSON.stringify({sessionId,problemId:problem?.id??null,url,statement,submission,code:'',source:'paste',fileName:null,confirmed:false});
            setCreatePending(false);
            attempt.current = null;
            await readDetail(r.review.id,true);
        }
        catch (e) {
            if(alive.current&&epoch===lifecycle.current&&grant===accessEpoch.current){
                invalidateAccess(e);
                if(e instanceof ClientError&&e.status>=400&&e.status<500&&![408,429].includes(e.status)){attempt.current=null;setCreatePending(false);}
                else if(attempt.current)setCreatePending(true);
                setError(e instanceof ClientError?e.message:attempt.current?'快照保存结果尚未确认；代码与原编号保留，请显式重试原快照保存。':e instanceof Error?e.message:'请核对快照输入。');
            }
        }
        finally {
            if(alive.current&&epoch===lifecycle.current){operationInFlight.current=false;setBusy(false);}
        }
    }
    async function generate(retry = false) {
        if (!selected || !accessReady || accessDenied || createPending || notePending || reading || operationInFlight.current || generationInFlight.current || (pendingGeneration && !retry))
            return;
        const current = retry ? pendingGeneration : {
            reviewId: selected.id, requestId: crypto.randomUUID(), question,
        };
        if (!current || current.reviewId !== selected.id) return;
        generationInFlight.current = true;
        operationInFlight.current=true;const epoch=lifecycle.current,seq=loadSequence.current,grant=accessEpoch.current;
        setPendingGeneration(current);
        setBusy(true);
        setError("");
        try {
            const r = await requestJson<{
                results: ReviewResult[];
            }>(`/api/v1/reviews/${current.reviewId}/generate`, { method: "POST", body: { requestId: current.requestId, question: current.question } });
            if(!alive.current||epoch!==lifecycle.current||seq!==loadSequence.current||grant!==accessEpoch.current)return;
            setResults(reviewResultSchema.array().parse(r.results));
            setQuestion("");
            setPendingGeneration(null);
        }
        catch (e) {
            if(!alive.current||epoch!==lifecycle.current||seq!==loadSequence.current||grant!==accessEpoch.current)return;
            invalidateAccess(e);
            if (e instanceof ClientError && isGenerationDenied(e.code)) {
                setPendingGeneration(null);
                setError(e.message);
                return;
            }
            // Network errors, unreadable responses and 5xx may follow a committed result.
            // Only a definitive 4xx refusal (other than an active lease) releases the ID.
            if (e instanceof ClientError && e.status >= 400 && e.status < 500 && e.code !== "TUTOR_BUSY") {
                setPendingGeneration(null);
            }
            const message = e instanceof ClientError
                ? e.code === "REVIEW_REQUEST_FAILED"
                    ? "上次生成请求已确认结束或过期。本次未再次调用模型；如需重新生成，请再次点击生成或发送追问。"
                    : e.message
                : "复盘请求结果尚未确认，请重试上次生成请求以核对结果。";
            setError(message.includes("可能已产生模型用量") ? message : `${message}可能已产生模型用量；追问草稿与原有结果保留，请检查后再决定是否重试。`);
        }
        finally {
            if(alive.current&&epoch===lifecycle.current){generationInFlight.current = false;operationInFlight.current=false;setBusy(false);}
        }
    }
    async function save(retry=false) {
        if (!selected||!accessReady||accessDenied||reading||operationInFlight.current||(notePending&&!retry))
            return;
        operationInFlight.current=true;const epoch=lifecycle.current,seq=loadSequence.current,grant=accessEpoch.current;
        if(!retry)noteAttempt.current={id:selected.id,revision:selected.revision,notes};
        const ticket=noteAttempt.current!;
        setBusy(true);
        setError("");
        try {
            const r = await requestJson<{
                review: CodeReview;
            }>(`/api/v1/reviews/${ticket.id}`, { method: "PATCH", body: { revision: ticket.revision, notes:ticket.notes },timeoutMs:15_000 });
            if(!alive.current||epoch!==lifecycle.current||seq!==loadSequence.current||grant!==accessEpoch.current)return;
            if(r.review.id!==ticket.id||(scope.current&&r.review.user_id!==scope.current.owner))throw new ClientError(403,'复盘归属无法重新核验。');
            claimOwner([r.review.user_id]);
            setSelected(r.review);
            scope.current={id:r.review.id,owner:r.review.user_id,notes:r.review.notes};noteAttempt.current=null;setNotePending(false);
            setItems(old => old.map(x => x.id === r.review.id ? r.review : x));
        }
        catch (e) {
            if(alive.current&&epoch===lifecycle.current&&seq===loadSequence.current&&grant===accessEpoch.current){
                invalidateAccess(e);
                if(e instanceof ClientError&&e.status>=400&&e.status<500&&![408,429].includes(e.status)){noteAttempt.current=null;setNotePending(false);}
                else setNotePending(true);
                if(e instanceof ClientError&&e.status===409)setAccessReady(false);
                setError(e instanceof ClientError?e.message:'笔记保存结果尚未确认；本地编辑保留，请先核对保存状态。');
            }
        }
        finally {
            if(alive.current&&epoch===lifecycle.current){operationInFlight.current=false;setBusy(false);}
        }
    }
    return <div className="space-y-6">
    <p className="text-xs text-muted-foreground">未保存代码、题面、笔记与追问仅在当前页面保留，不写入浏览器持久存储。刷新或确认离开后不保证恢复，请先保存、核对或复制。已保存快照与完成分析可重新读取；重新进入不会自动生成。原生警告受浏览器限制，不支持 Navigation API 时不能保证拦截同文档后退。</p>
    {invalidTarget&&<p role="alert" aria-label="复盘链接错误">复盘链接中的记录标识无效，请使用已有的合法历史链接；不会猜测或枚举记录。</p>}
    {!invalidTarget&&recoverId&&<Button variant="outline" disabled={busy} onClick={()=>void readDetail(recoverId)}>重新核验当前复盘</Button>}
    {reading&&<p role="status">正在重新核验复盘，核验前不展示旧快照或分析。</p>}
    {!accessDenied&&<Card><CardHeader><CardTitle>AC 后导入 C++ 代码</CardTitle></CardHeader><CardContent>
      <p className="mb-4 text-sm leading-6 text-muted-foreground">本地 VS Code 编写、调试，Codeforces 官网手动提交。这里只做静态分析，不执行代码。文件选择仅在浏览器读取你选中的单个文件；保存快照后，点击生成或追问会将代码、题面及近期复盘发送给服务端配置的 AI Provider。请先删除密钥、私人路径和其他敏感内容。</p>
      <form onSubmit={create} className="space-y-3">
      <fieldset disabled={busy||createPending} className="space-y-3">
<ProblemPicker disabled={busy} onSelect={p=>{setProblem(p);setSessionId("");setUrl(cfUrl(p.contestId,p.index));}}/>
{problem&&<p>当前 CF 题目：{cfKey(problem.contestId,problem.index)} · {problem.name}</p>}

        <label className="block text-sm" htmlFor="review-session">关联训练（可选）</label>
        <select id="review-session" className="w-full min-w-0 rounded border bg-background p-2 text-sm" value={sessionId} disabled={busy} onChange={e => {setSessionId(e.target.value);setProblem(null);}}><option value="">新建独立复盘</option>{initialSessionId && !sessions.some(s => s.id === initialSessionId) && <option value={initialSessionId}>当前训练</option>}{sessions.filter(s => s.mode !== "contest").map(s => <option key={s.id} value={s.id}>{s.created_at.slice(0, 10)} · {s.id.slice(0, 8)} · {s.status}</option>)}</select>
        {sessionState.phase==='error'&&<p role="alert" aria-label="关联训练列表状态" className="text-sm">{sessionState.message}<Button type="button" variant="ghost" disabled={busy} onClick={()=>void readCollection('sessions')}>重试关联训练列表</Button></p>}
        <label className="block text-sm" htmlFor="review-url">Codeforces 题目 URL（可选）</label><Input id="review-url" value={url} maxLength={200} disabled={busy} onChange={e => setUrl(e.target.value)} placeholder="https://codeforces.com/problemset/problem/1234/A"/>
        <label className="block text-sm" htmlFor="review-statement">题面、约束与样例（可选，关联训练时默认使用原快照）</label><Textarea id="review-statement" value={statement} maxLength={16000} disabled={busy} onChange={e => setStatement(e.target.value)}/>
        <label className="block text-sm" htmlFor="review-submission">提交 ID（可选）</label><Input id="review-submission" value={submission} maxLength={18} inputMode="numeric" disabled={busy} onChange={e => setSubmission(e.target.value)}/>
        <p className="text-xs text-muted-foreground">本轮结果为用户自报 AC，官方状态尚未同步到此代码快照。关联公开账号的结果在推荐/画像中单独使用；用户填写的提交 ID 本身不证明 AC，也不证明导入代码与官方源码一致。</p>
        <label className="block text-sm" htmlFor="review-file">选择本地代码文件（UTF-8，最多 64 KB）</label><input id="review-file" type="file" accept=".cpp,.cc,.cxx,.txt" disabled={busy} className="block w-full min-w-0 text-sm" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file)
        return; if(operationInFlight.current)return;operationInFlight.current=true;const epoch=lifecycle.current,seq=loadSequence.current;setError(""); setBusy(true); try {
        const content = await readCodeFile(file);
        if(!alive.current||epoch!==lifecycle.current||seq!==loadSequence.current)return;
        setCode(content);
        setSource("file");
        setFileName(file.name);
    }
    catch (f) {
        if(alive.current&&epoch===lifecycle.current)setError(f instanceof Error ? f.message : "读取失败。");
    }
    finally {
        if(alive.current&&epoch===lifecycle.current){operationInFlight.current=false;setBusy(false);}
    } }}/>
        <label className="block text-sm" htmlFor="review-code">C++ 代码快照</label><Textarea id="review-code" value={code} maxLength={64000} disabled={busy} spellCheck={false} className="min-h-48 font-mono text-xs" onChange={e => { setCode(e.target.value); setSource("paste"); setFileName(null); }}/>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/><span>我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘。关联的未完成训练将结束，完整解释独立于 AC 前提示历史。</span></label>
        <Button disabled={busy || Boolean(pendingGeneration) || !confirmed || !code.trim()}>确认进入复盘并保存快照</Button>
      </fieldset>
      </form>
      {createPending&&<div className="mt-3 space-y-2"><p role="status">快照保存结果 UNKNOWN。代码、导入选项和原编号保持不变；重试只核对或保存原快照，不调用模型。</p><Button disabled={busy} onClick={()=>void create(undefined,true)}>重试原快照保存</Button></div>}
    </CardContent></Card>
    }
    {error && <p role="alert" aria-label="复盘错误" className="break-words text-sm text-destructive">{error}</p>}
    <section aria-label="历史复盘列表" className="space-y-3">
      <Button variant="outline" disabled={listState.phase==='loading'} onClick={()=>void readCollection('reviews')}>重新读取历史列表</Button>
      {listState.phase==='loading'&&<p role="status">正在读取历史列表；已知复盘链接可独立核验，不必等待列表。</p>}
      {listState.phase==='error'&&<p role="alert" aria-label="复盘列表状态" className="text-sm">{listState.message}</p>}
      {listState.phase==='ready'&&<p className="text-xs text-muted-foreground">本次历史列表返回 {items.length} 条，最多100条，按创建时间倒序；不是全部历史的完整性证明。</p>}
      {listState.phase==='ready'&&<div className="flex flex-wrap gap-2">{items.map(r=><Button key={r.id} variant="outline" size="sm" disabled={busy||Boolean(pendingGeneration)||notePending||createPending} onClick={()=>void open(r.id)}>复盘 {r.created_at.slice(0,19).replace('T',' ')} · {r.id.slice(0,8)}</Button>)}</div>}
      {listState.phase==='ready'&&items.length===0&&<p className="text-sm text-muted-foreground">{selected&&accessReady?'本次列表未返回记录；已单独核验的当前复盘仍可使用。':'尚无复盘。保存快照后可生成 AI 分析。'}</p>}
    </section>
    {selected && accessReady && !invalidTarget && <Card><CardHeader><CardTitle>代码快照复盘 · {selected.code_hash.slice(0, 12)}</CardTitle></CardHeader><CardContent className="min-w-0 space-y-5">
      <p className="break-words text-xs text-muted-foreground">自报 AC · 官方状态未核实 · 源码一致性未验证 · {selected.created_at} · 来源：{selected.source === "file" ? selected.file_name : "粘贴文本"} · {selected.code_snapshot.split("\n").length} 行</p>
      <p className="text-xs text-muted-foreground">AI 静态分析未运行或验证代码。每份分析绑定此不可变快照；修改代码请在上方创建新复盘。用户编辑单独保存，原始分析与历史生成记录保留。</p>
      <Link href={`/practice/${selected.session_id}`} className="text-sm underline" onClick={event=>{if(!window.dispatchEvent(new Event('algopilot-before-navigate',{cancelable:true})))event.preventDefault();}}>查看原训练和提示历史</Link>
      <details><summary className="cursor-pointer text-sm">查看本次代码快照与授权记录</summary><pre className="mt-3 max-h-96 overflow-auto rounded border p-3 text-xs">{selected.code_snapshot.split("\n").map((line, i) => `${i + 1}: ${line}`).join("\n")}</pre><p className="mt-3 break-words text-xs">进入状态：{selected.authorization_event.status} · 原结果：{selected.authorization_event.outcome ?? "未记录"} · 授权：{selected.authorization_event.authorizedAt} · 原允许等级 L{selected.authorization_event.allowedLevel} / 已查看 L{selected.authorization_event.maxSeenLevel}</p></details>
      {!configured && <p role="status" className="text-sm">AI 未配置，快照与编辑可以保存；生成、重新生成和追问禁用。</p>}
      <Button disabled={busy || !configured || createPending || notePending || Boolean(pendingGeneration)} onClick={() => void generate()}>{busy ? "正在处理…" : results.length ? "重新生成 AI 复盘" : "生成 AI 复盘"}</Button>
      {pendingGeneration && !busy && <div className="space-y-2">
        <p role="status" className="text-sm">上次生成结果尚未确认。重试沿用原请求编号与原问题，已完成的结果会直接恢复；可能已产生模型用量。确认结果前请保留此页面。</p>
        <Button disabled={!configured} onClick={() => void generate(true)}>重试上次生成请求</Button>
      </div>}
      {results.map((r, i) => <details key={r.id} open={i === 0}><summary className="cursor-pointer break-words text-sm">{i === 0 ? "最新分析" : "历史分析"} · {r.model} · {r.prompt_version} · {r.created_at}</summary>{r.question && <p className="mt-3 whitespace-pre-wrap break-words text-sm">追问：{r.question}</p>}<TutorMarkdown content={analysisMarkdown(r.analysis)}/></details>)}
      <label className="block text-sm" htmlFor="review-notes">用户编辑复盘</label><Textarea id="review-notes" value={notes} maxLength={16000} disabled={busy||notePending} className="min-h-40" onChange={e => setNotes(e.target.value)}/>
      <div className="flex flex-wrap gap-2"><Button disabled={busy||notePending||createPending} onClick={() => void save()}>保存用户编辑</Button>{results[0] && <Button variant="outline" disabled={busy||notePending} onClick={() => setNotes(analysisMarkdown(results[0]!.analysis).slice(0, 16000))}>复制最新分析到编辑区</Button>}</div>
      {notePending&&<div className="space-y-2"><p role="status">笔记保存结果 UNKNOWN，原 revision 与编辑保留。先读取服务器核对；只有显式重试才会再次保存，不生成分析。</p><Button disabled={busy} variant="outline" onClick={()=>void readDetail(selected.id)}>核对笔记保存状态</Button><Button disabled={busy} variant="outline" onClick={()=>void save(true)}>重试原笔记保存</Button></div>}
      <label className="block text-sm" htmlFor="review-question">后续复盘问题</label><p className="text-xs text-muted-foreground">可附 WA / RE / TLE 对照片段，请注明版本；数值行号分析只对应已保存的 AC 快照。AI 仅做静态推导，反例及预计输出未经执行核验。</p><Textarea id="review-question" value={question} maxLength={3000} disabled={busy || createPending || !configured || Boolean(pendingGeneration)} onChange={e => setQuestion(e.target.value)}/><Button disabled={busy || !configured || createPending || notePending || Boolean(pendingGeneration) || !question.trim()} onClick={() => void generate()}>发送复盘追问</Button>
    </CardContent></Card>}
  </div>;
}
