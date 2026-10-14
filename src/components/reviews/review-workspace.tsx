"use client";
import { ProblemPicker } from "@/components/problems/problem-picker";
import {cfKey,cfUrl,type CatalogProblem} from "@/lib/validation/m3";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TutorMarkdown from "@/components/practice/tutor-markdown";
import { requestJson } from "@/lib/api-client";
import { readCodeFile } from "@/features/reviews/import-code";
import { createReviewSchema, type CodeReview, type ReviewResult, type ReviewAnalysis } from "@/lib/validation/review";
import type { TrainingSession } from "@/lib/validation/m1";
export function analysisMarkdown(a: ReviewAnalysis) {
    return `## 算法思路\n${a.summary}\n\n## 正确性证明摘要\n${a.correctness}\n\n## 未证明的假设\n${a.assumptions}\n\n## 时间复杂度\n${a.timeComplexity}\n\n## 空间复杂度\n${a.spaceComplexity}\n\n## 代码行分析\n${a.lineAnalysis.map(l => `- 第 ${l.start}–${l.end} 行：${l.analysis}`).join("\n")}\n\n## 潜在缺陷与边界\n${a.risks}\n\n## 实现改进\n${a.improvements}\n\n## 其他思路（可选）\n${a.alternatives || "未提供"}\n\n## 可迁移知识点\n${a.transferableKnowledge}\n\n## 复习问题\n${a.revisionQuestions.map(q => `- ${q}`).join("\n")}\n\n${a.answer ? `## 追问回答\n${a.answer}` : ""}`;
}
export function ReviewWorkspace({ initialSessionId = "", initialReviewId = "" }: {
    initialSessionId?: string;
    initialReviewId?: string;
}) {
    const [items, setItems] = useState<CodeReview[]>([]);
    const [sessions, setSessions] = useState<TrainingSession[]>([]);
    const [selected, setSelected] = useState<CodeReview | null>(null);
    const [results, setResults] = useState<ReviewResult[]>([]);
    const [configured, setConfigured] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [busy, setBusy] = useState(false);
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
    const attempt = useRef<{
        payload: string;
        id: string;
    } | null>(null);
    const loadSequence = useRef(0);
    useEffect(() => {
        let active = true;
        Promise.all([requestJson<{
                items: CodeReview[];
            }>("/api/v1/reviews"), requestJson<{
                items: TrainingSession[];
            }>("/api/v1/sessions?limit=50")]).then(([r, s]) => { if (active) {
            setItems(r.items);
            setSessions(s.items);
            setLoaded(true);
        } }).catch(e => { if (active)
            setError(e instanceof Error ? e.message : "复盘加载失败，请刷新重试。"); });
        return () => { active = false; };
    }, []);
    useEffect(() => {
      if (!initialReviewId) return;
      let active = true;
      const sequence = ++loadSequence.current;
      requestJson<{review:CodeReview;results:ReviewResult[];configured:boolean}>(`/api/v1/reviews/${initialReviewId}`).then(r=>{
        if(active && sequence === loadSequence.current){setSelected(r.review);setNotes(r.review.notes);setResults(r.results);setConfigured(r.configured);}
      }).catch(e=>{if(active)setError(e instanceof Error?e.message:"复盘恢复失败。");});
      return ()=>{active=false;};
    }, [initialReviewId]);
    const dirty = Boolean(code || (selected && notes !== selected.notes));
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => { if (dirty) {
            event.preventDefault();
            event.returnValue = "";
        } };
        const guard = (event: Event) => { if (dirty) {
            event.preventDefault();
            setError("有未保存的复盘内容，请先保存或复制后再离开。");
        } };
        window.addEventListener("beforeunload", warn);
        window.addEventListener("algopilot-before-navigate", guard);
        return () => { window.removeEventListener("beforeunload", warn); window.removeEventListener("algopilot-before-navigate", guard); };
    }, [dirty]);
    async function open(id: string) {
        if (selected && notes !== selected.notes) {
            setError("请先保存用户编辑内容，再切换复盘。");
            return;
        }
        const seq = ++loadSequence.current;
        setBusy(true);
        setError("");
        try {
            const r = await requestJson<{
                review: CodeReview;
                results: ReviewResult[];
                configured: boolean;
            }>(`/api/v1/reviews/${id}`);
            if (seq === loadSequence.current) {
                setSelected(r.review);
                setNotes(r.review.notes);
                setResults(r.results);
                setConfigured(r.configured);
                window.history.replaceState(window.history.state,"",`/reviews?reviewId=${r.review.id}`);
            }
        }
        catch (e) {
            if (seq === loadSequence.current)
                setError(e instanceof Error ? e.message : "加载失败。");
        }
        finally {
            if (seq === loadSequence.current)
                setBusy(false);
        }
    }
    async function create(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
            if (!confirmed)
                throw new Error("请明确确认自报 AC 与 Provider 数据发送授权。");
            if (selected && notes !== selected.notes)
                throw new Error("请先保存用户编辑内容。");
            if(!sessionId&&!problem)throw new Error("请先选择 Codeforces 题目，或关联已有训练。");
            const body = { sessionId: sessionId || null, code, source, fileName, problemUrl: url, statement, submissionId: submission || null, confirmation: "我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘" as const };
            const payload = JSON.stringify(body);
            if (attempt.current?.payload !== payload)
                attempt.current = { payload, id: crypto.randomUUID() };
            const input = createReviewSchema.safeParse({ ...body, requestId: attempt.current.id });
            if (!input.success)
                throw new Error("代码、文件来源、题目 URL 或提交 ID 格式不正确。仅接受 Codeforces 官方 HTTPS 题目链接及最多 64 KB 的 UTF-8 文本。");
            const r = await requestJson<{
                review: CodeReview;
            }>("/api/v1/reviews", { method: "POST", body: {...input.data,...(problem?{problemId:problem.id}:{})} });
            setItems(old => [r.review, ...old.filter(x => x.id !== r.review.id)]);
            setCode("");
            setConfirmed(false);
            attempt.current = null;
            await open(r.review.id);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "保存快照失败。");
        }
        finally {
            setBusy(false);
        }
    }
    async function generate() {
        if (!selected)
            return;
        setBusy(true);
        setError("");
        try {
            const r = await requestJson<{
                results: ReviewResult[];
            }>(`/api/v1/reviews/${selected.id}/generate`, { method: "POST", body: { requestId: crypto.randomUUID(), question } });
            setResults(r.results);
            setQuestion("");
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "复盘失败。");
        }
        finally {
            setBusy(false);
        }
    }
    async function save() {
        if (!selected)
            return;
        setBusy(true);
        setError("");
        try {
            const r = await requestJson<{
                review: CodeReview;
            }>(`/api/v1/reviews/${selected.id}`, { method: "PATCH", body: { revision: selected.revision, notes } });
            setSelected(r.review);
            setItems(old => old.map(x => x.id === r.review.id ? r.review : x));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "保存失败。本地编辑保留。");
        }
        finally {
            setBusy(false);
        }
    }
    return <div className="space-y-6">
    <Card><CardHeader><CardTitle>AC 后导入 C++ 代码</CardTitle></CardHeader><CardContent>
      <p className="mb-4 text-sm leading-6 text-muted-foreground">本地 VS Code 编写、调试，Codeforces 官网手动提交。这里只做静态分析，不执行代码。文件选择仅在浏览器读取你选中的单个文件；保存快照后，点击生成或追问会将代码、题面及近期复盘发送给服务端配置的 AI Provider。请先删除密钥、私人路径和其他敏感内容。</p>
      <form onSubmit={create} className="space-y-3">
<ProblemPicker disabled={busy} onSelect={p=>{setProblem(p);setSessionId("");setUrl(cfUrl(p.contestId,p.index));}}/>
{problem&&<p>当前 CF 题目：{cfKey(problem.contestId,problem.index)} · {problem.name}</p>}

        <label className="block text-sm" htmlFor="review-session">关联训练（可选）</label>
        <select id="review-session" className="w-full min-w-0 rounded border bg-background p-2 text-sm" value={sessionId} disabled={busy} onChange={e => {setSessionId(e.target.value);setProblem(null);}}><option value="">新建独立复盘</option>{initialSessionId && !sessions.some(s => s.id === initialSessionId) && <option value={initialSessionId}>当前训练</option>}{sessions.filter(s => s.mode !== "contest").map(s => <option key={s.id} value={s.id}>{s.created_at.slice(0, 10)} · {s.id.slice(0, 8)} · {s.status}</option>)}</select>
        <label className="block text-sm" htmlFor="review-url">Codeforces 题目 URL（可选）</label><Input id="review-url" value={url} maxLength={200} disabled={busy} onChange={e => setUrl(e.target.value)} placeholder="https://codeforces.com/problemset/problem/1234/A"/>
        <label className="block text-sm" htmlFor="review-statement">题面、约束与样例（可选，关联训练时默认使用原快照）</label><Textarea id="review-statement" value={statement} maxLength={16000} disabled={busy} onChange={e => setStatement(e.target.value)}/>
        <label className="block text-sm" htmlFor="review-submission">提交 ID（可选）</label><Input id="review-submission" value={submission} maxLength={18} inputMode="numeric" disabled={busy} onChange={e => setSubmission(e.target.value)}/>
        <p className="text-xs text-muted-foreground">本轮结果为用户自报 AC，官方状态尚未同步到此代码快照。关联公开账号的结果在推荐/画像中单独使用；用户填写的提交 ID 本身不证明 AC，也不证明导入代码与官方源码一致。</p>
        <label className="block text-sm" htmlFor="review-file">选择本地代码文件（UTF-8，最多 64 KB）</label><input id="review-file" type="file" accept=".cpp,.cc,.cxx,.txt" disabled={busy} className="block w-full min-w-0 text-sm" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file)
        return; setError(""); setBusy(true); try {
        const content = await readCodeFile(file);
        setCode(content);
        setSource("file");
        setFileName(file.name);
    }
    catch (f) {
        setError(f instanceof Error ? f.message : "读取失败。");
    }
    finally {
        setBusy(false);
    } }}/>
        <label className="block text-sm" htmlFor="review-code">C++ 代码快照</label><Textarea id="review-code" value={code} maxLength={64000} disabled={busy} spellCheck={false} className="min-h-48 font-mono text-xs" onChange={e => { setCode(e.target.value); setSource("paste"); setFileName(null); }}/>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/><span>我确认本次为自报 AC，并授权将代码发送给配置的 AI Provider 进行完整复盘。关联的未完成训练将结束，完整解释独立于 AC 前提示历史。</span></label>
        <Button disabled={busy || !confirmed || !code.trim()}>确认进入复盘并保存快照</Button>
      </form>
    </CardContent></Card>
    {error && <p role="alert" aria-label="复盘错误" className="break-words text-sm text-destructive">{error}</p>}
    {!loaded && !error && <p role="status">正在加载复盘…</p>}
    <div className="flex flex-wrap gap-2">{items.map(r => <Button key={r.id} variant="outline" size="sm" disabled={busy} onClick={() => void open(r.id)}>复盘 {r.created_at.slice(0, 19).replace("T", " ")} · {r.id.slice(0, 8)}</Button>)}</div>
    {loaded && items.length === 0 && <p className="text-sm text-muted-foreground">尚无复盘。保存快照后可生成 AI 分析。</p>}
    {selected && <Card><CardHeader><CardTitle>代码快照复盘 · {selected.code_hash.slice(0, 12)}</CardTitle></CardHeader><CardContent className="min-w-0 space-y-5">
      <p className="break-words text-xs text-muted-foreground">自报 AC · 官方状态未核实 · 源码一致性未验证 · {selected.created_at} · 来源：{selected.source === "file" ? selected.file_name : "粘贴文本"} · {selected.code_snapshot.split("\n").length} 行</p>
      <p className="text-xs text-muted-foreground">AI 静态分析未运行或验证代码。每份分析绑定此不可变快照；修改代码请在上方创建新复盘。用户编辑单独保存，原始分析与历史生成记录保留。</p>
      <Link href={`/practice/${selected.session_id}`} className="text-sm underline" onClick={event=>{if(dirty){event.preventDefault();setError("有未保存的复盘内容，请先保存或复制后再离开。");}}}>查看原训练和提示历史</Link>
      <details><summary className="cursor-pointer text-sm">查看本次代码快照与授权记录</summary><pre className="mt-3 max-h-96 overflow-auto rounded border p-3 text-xs">{selected.code_snapshot.split("\n").map((line, i) => `${i + 1}: ${line}`).join("\n")}</pre><p className="mt-3 break-words text-xs">进入状态：{selected.authorization_event.status} · 原结果：{selected.authorization_event.outcome ?? "未记录"} · 授权：{selected.authorization_event.authorizedAt} · 原允许等级 L{selected.authorization_event.allowedLevel} / 已查看 L{selected.authorization_event.maxSeenLevel}</p></details>
      {!configured && <p role="status" className="text-sm">AI 未配置，快照与编辑可以保存；生成、重新生成和追问禁用。</p>}
      <Button disabled={busy || !configured} onClick={() => void generate()}>{busy ? "正在处理…" : results.length ? "重新生成 AI 复盘" : "生成 AI 复盘"}</Button>
      {results.map((r, i) => <details key={r.id} open={i === 0}><summary className="cursor-pointer break-words text-sm">{i === 0 ? "最新分析" : "历史分析"} · {r.model} · {r.prompt_version} · {r.created_at}</summary>{r.question && <p className="mt-3 whitespace-pre-wrap break-words text-sm">追问：{r.question}</p>}<TutorMarkdown content={analysisMarkdown(r.analysis)}/></details>)}
      <label className="block text-sm" htmlFor="review-notes">用户编辑复盘</label><Textarea id="review-notes" value={notes} maxLength={16000} disabled={busy} className="min-h-40" onChange={e => setNotes(e.target.value)}/>
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void save()}>保存用户编辑</Button>{results[0] && <Button variant="outline" disabled={busy} onClick={() => setNotes(analysisMarkdown(results[0]!.analysis).slice(0, 16000))}>复制最新分析到编辑区</Button>}</div>
      <label className="block text-sm" htmlFor="review-question">后续复盘问题</label><Textarea id="review-question" value={question} maxLength={3000} disabled={busy || !configured} onChange={e => setQuestion(e.target.value)}/><Button disabled={busy || !configured || !question.trim()} onClick={() => void generate()}>发送复盘追问</Button>
    </CardContent></Card>}
  </div>;
}
