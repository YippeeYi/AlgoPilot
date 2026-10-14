// Offline assessment data only. Never imported by src/ or used as user ability evidence.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Row = Record<string, string>;
export const assessments = ["适合", "偏简单", "偏困难", "方向不符", "理由缺乏证据"] as const;
export function parseCsv(input: string): Row[] {
    const text = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
    const field = () => { row.push(cell); cell = ""; closed = false; };
    const record = () => { field(); if (row.some(v => v.length)) rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (quoted) {
            if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (c === '"') { quoted = false; closed = true; }
            else cell += c;
        } else if (c === ',' ) field();
        else if (c === '\n') record();
        else if (c === '"' && !cell && !closed) quoted = true;
        else { if (closed || c === '"' || c === '\r') throw new Error("Malformed CSV field"); cell += c; }
    }
    if (quoted) throw new Error("Unclosed CSV quote");
    if (cell || row.length) record();
    const headers = rows.shift();
    if (!headers || new Set(headers).size !== headers.length || headers.some(h => !h)) throw new Error("Invalid CSV header");
    return rows.map(values => {
        if (values.length !== headers.length) throw new Error("CSV column count mismatch");
        return Object.fromEntries(headers.map((h, i) => [h, values[i]!]));
    });
}
export function csv(rows: Row[], headers: string[]) {
    const escape = (v: string) => '"' + v.replaceAll('"', '""') + '"';
    return [headers, ...rows.map(r => headers.map(h => r[h] ?? ""))].map(r => r.map(escape).join(',')).join('\n') + '\n';
}
export const reviewKey = (r: Row) => `${r.scenario}:${r.problem_key}`;
type Recorded = { matrix: { id: string; items: { problem: { contestId: number; index: string; rating: number | null } }[] }[] };
type SourceCheck = { scenario: string; key: string; status: string; sources: string[]; finding: string };
export function integrateReviews(recorded: Recorded, manual: Row[], ai: Row[], human: Row[] = [], previous: Row[] = [], sourceChecks: SourceCheck[] = []) {
    const expected = new Map<string, { contestId: number; index: string; rating: number | null }>(recorded.matrix.flatMap(s => s.items.map(i => [`${s.id}:${i.problem.contestId}/${i.problem.index}`, i.problem] as const)));
    if (expected.size !== 40) throw new Error("Expected 40 unique recorded recommendations");
    const validate = (rows: Row[], kind: "ai" | "human" | "original", full: boolean) => {
        if (full && rows.length !== 40) throw new Error("Expected 40 review rows");
        const seen = new Set<string>();
        for (const r of rows) {
            for (const h of ["scenario", "problem_key", "assessment", "suggestion", "reviewer", "reviewed_at", "statement_consulted"])
                if (!(h in r)) throw new Error(`Missing review column ${h}`);
            const key = reviewKey(r), p = expected.get(key);
            if (!p || !/^[1-9]\d*\/[A-Z0-9]{1,12}$/.test(r.problem_key!) || seen.has(key)) throw new Error("Invalid or duplicate scenario/problem key");
            seen.add(key);
            if (r.official_url !== undefined && r.official_url !== `https://codeforces.com/problemset/problem/${r.problem_key}`) throw new Error("Official URL mismatch");
            if (r.rating !== undefined && r.rating !== String(p.rating ?? "")) throw new Error("Rating mismatch");
            if (r.assessment && !assessments.includes(r.assessment as typeof assessments[number])) throw new Error("Invalid assessment");
            if (kind === "ai" && (r.assessment ? !r.rationale || r.review_type !== "AI初评，非真人评价" || !/AI|GPT/i.test(r.reviewer!) : r.review_type !== "unreviewed")) throw new Error("Invalid AI provenance");
            if (kind === "human" && r.review_type !== "human") throw new Error("Human override must explicitly use review_type=human");
            if (r.assessment) {
                if (!r.reviewer?.trim() || (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(r.reviewed_at!) || !Number.isFinite(Date.parse(r.reviewed_at!)) || new Date(r.reviewed_at!).toISOString().slice(0, 10) !== r.reviewed_at!.slice(0, 10)) || !r.statement_consulted?.trim()) throw new Error("Incomplete review provenance");
                if (kind !== "ai" && /AI|GPT|模型|Codex/i.test(r.reviewer!)) throw new Error("AI reviewer cannot count as human");
            } else if (r.reviewer || r.reviewed_at || r.statement_consulted || r.suggestion || r.rationale) throw new Error("Incomplete unassessed row");
        }
        return new Map(rows.map(r => [reviewKey(r), r]));
    };
    const originals = validate(manual, "original", true), assisted = validate(ai, "ai", true), overrides = validate(human, "human", false);
    const checked = new Map<string, SourceCheck>();
    for (const check of sourceChecks) {
        const key = `${check.scenario}:${check.key}`;
        if (!expected.has(key) || checked.has(key) || !["compatibility_confirmed", "specialization_risk_supported", "context_uncertain"].includes(check.status) || !check.finding || !check.sources.length) throw new Error("Invalid source audit key/status");
        for (const source of check.sources) { const url = new URL(source); if (url.protocol !== "https:" || !["codeforces.com", "assets.codeforces.com"].includes(url.hostname) || url.username || url.password) throw new Error("Invalid audit source"); }
        checked.set(key, check);
    }
    const old = new Map(previous.map(r => [reviewKey(r), r]));
    const audit: { key: string; before: Row | null; after: Row | null }[] = [];
    const rows = [...expected.keys()].map(key => {
        const a = assisted.get(key)!, m = originals.get(key)!, h = overrides.get(key)?.assessment ? overrides.get(key)! : m.assessment ? m : null;
        const now: Row = { scenario: a.scenario!, problem_key: a.problem_key!, ai_assessment: a.assessment!, ai_rationale: a.rationale!, ai_reviewer: a.reviewer!, ai_reviewed_at: a.reviewed_at!, ai_statement_consulted: a.statement_consulted!, ai_review_type: a.review_type!, ai_suggestion: a.suggestion!,
            human_assessment: h?.assessment ?? "", human_rationale: h?.rationale ?? "", human_suggestion: h?.suggestion ?? "", human_reviewer: h?.reviewer ?? "", human_reviewed_at: h?.reviewed_at ?? "", human_statement_consulted: h?.statement_consulted ?? "",
            effective_assessment: h?.assessment ?? a.assessment!, effective_source: h ? "human" : a.assessment ? "ai_assisted_pending" : "unreviewed", verification: h ? "human_reviewed" : a.assessment ? "pending" : "unreviewed",
            source_check_status: checked.get(key)?.status ?? "unconfirmed", source_check_sources: checked.get(key)?.sources.join(';') ?? "", source_check_finding: checked.get(key)?.finding ?? "" };
        const prev = old.get(key);
        const humanFields = ["human_assessment", "human_rationale", "human_suggestion", "human_reviewer", "human_reviewed_at", "human_statement_consulted"];
        if (humanFields.some(f => (prev?.[f] ?? "") !== now[f])) audit.push({ key, before: prev ? Object.fromEntries(humanFields.map(f => [f, prev[f] ?? ""])) : null, after: h ? Object.fromEntries(humanFields.map(f => [f, now[f]!])) : null });
        return now;
    });
    const counts = (values: string[]) => Object.fromEntries(assessments.map(a => [a, values.filter(v => v === a).length]));
    const summary = recorded.matrix.map(s => {
        const rs = rows.filter(r => r.scenario === s.id), hs = rs.filter(r => r.human_assessment);
        const aiCount = rs.filter(r => r.ai_assessment).length;
        return { scenario: s.id, total: rs.length, aiCompleted: aiCount, unreviewed: rs.filter(r => r.effective_source === 'unreviewed').length, ai: counts(rs.map(r => r.ai_assessment!)), aiFitRate: aiCount ? rs.filter(r => r.ai_assessment === "适合").length / aiCount : null,
            humanCompleted: hs.length, human: counts(hs.map(r => r.human_assessment!)), humanFitRate: hs.length ? hs.filter(r => r.human_assessment === "适合").length / hs.length : null,
            anomalies: rs.filter(r => r.effective_assessment && r.effective_assessment !== "适合").map(r => ({ key: r.problem_key, assessment: r.effective_assessment, source: r.effective_source, verification: r.verification })) };
    });
    return { version: "review-integration/1", rows, audit, summary, humanCompleted: rows.filter(r => r.human_assessment).length, aiCompleted: rows.filter(r => r.ai_assessment).length, pendingAI: rows.filter(r => r.effective_source === 'ai_assisted_pending').length, unreviewed: rows.filter(r => r.effective_source === 'unreviewed').length };
}

async function run() {
    const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] ?? fallback; };
    const out = arg("--output", "docs/m322");
    const paths = { recorded: arg("--recorded", "docs/m321/recorded-catalog-scenarios.json"), manual: arg("--manual", "docs/m321/manual-review.csv"), ai: arg("--ai", "docs/m321/ai-assisted-review.csv"), human: arg("--human", "docs/m322/human-overrides.csv"), audit: arg("--audit", "docs/m322/source-audit.json") };
    const inputs = await Promise.all(Object.entries(paths).map(async ([role, path]) => ({ role, path, raw: await readFile(path, "utf8") })));
    const data = Object.fromEntries(inputs.map(i => [i.role, i.raw]));
    const previousPath = arg("--previous", `${out}/review-summary.json`);
    let previousResult: { rows: Row[]; auditHistory?: unknown[] } | null = null;
    try { previousResult = JSON.parse(await readFile(previousPath, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const previous = previousResult?.rows ?? [];
    const result = integrateReviews(JSON.parse(data.recorded!), parseCsv(data.manual!), parseCsv(data.ai!), parseCsv(data.human!), previous, JSON.parse(data.audit!).items);
    const provenance = inputs.map(i => ({ role: i.role, path: i.path, sha256: createHash("sha256").update(i.raw).digest("hex") }));
    await mkdir(out, { recursive: true });
    await writeFile(`${out}/review-summary.json`, JSON.stringify({ ...result, auditHistory: [...(previousResult?.auditHistory ?? []), ...result.audit], provenance, boundary: "AI assisted labels are pending; source checks are separate, humans can override; never online learning evidence" }, null, 2) + '\n');
    await writeFile(`${out}/review-joined.csv`, csv(result.rows, Object.keys(result.rows[0]!)));
    console.log(JSON.stringify({ ai: result.aiCompleted, human: `${result.humanCompleted}/40`, pendingAI: result.pendingAI, unreviewed: result.unreviewed, humanChanges: result.audit.length, output: out }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
