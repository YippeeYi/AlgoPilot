import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type { PGlite } from "@electric-sql/pglite";
import { recommend, recommendationTarget, recommendationWeights, recommendationTopicMatch as topicMatch } from "@/features/learning/engine";
import { trainingCompatibility, teachingMetadata } from "@/features/learning/problem-fit";
import { candidatesSchema, type LearningCandidate } from "@/lib/validation/learning";
import { parseProblemset } from "@/server/codeforces/parser";
import { database, query, publish, bob } from "./database";
import { scenarios, emptyEvidence, training, fixtureId } from "./scenarios";
import { catalogRecording } from "./catalog-recording";
import * as before from "./m321-baseline-engine";
import { parseCsv } from "../../scripts/m322-review";
vi.mock("server-only", () => ({}));
let db: PGlite;
const oldSql = await readFile("supabase/migrations/202610140008_recommendation_audit.sql", "utf8");
const patch = await readFile("supabase/migrations/202610140009_recommendation_fit.sql", "utf8");
const replacement = patch.slice(patch.indexOf('create or replace function'), patch.indexOf('revoke all on function'));
const read = async (input: unknown) => candidatesSchema.parse((await query<{ v: unknown }>(db, 'select public.learning_candidates($1::jsonb) v', [JSON.stringify(input)])).rows[0]!.v);
const q = { min: 800, max: 3500, target: 1600, themes: [], repeat: false };
const candidate = (contestId: number, index: string, tags: string[], rating = 1500): LearningCandidate => ({ id: fixtureId(contestId), contestId, index, tags, rating, name: "Fixture", solvedCount: null, inPlan: false, practiced: false });
beforeAll(async () => { db = await database(); }, 30000);
afterAll(() => db?.close());
describe("M3.2.2 fit safeguards, controlled comparison on fixed metadata", () => {
    it("pre-budget SQL filtering does not blanket-ban *special, preserves 600 compatible slots and rejects user edits", async () => {
        const compatible = Array.from({ length: 650 }, (_, i) => ({ contestId: 20000 + i, index: 'A', name: 'Compatible control', rating: 1600, tags: ['*special', 'math'], solvedCount: null }));
        const interactive = Array.from({ length: 700 }, (_, i) => ({ ...compatible[0]!, contestId: 10000 + i, tags: ['interactive', 'math'] }));
        await publish(db, [...compatible, ...interactive, { ...compatible[0]!, contestId: 130, index: 'I' }, { ...compatible[0]!, contestId: 130, index: 'A', tags: [] }]);
        const pool = await read(q); expect(pool.policyVersion).toBe('training-fit/1'); expect(pool.total).toBe(650); expect(pool.items).toHaveLength(600); expect(pool.items.every(p => p.contestId >= 20000)).toBe(true);
        const expected = teachingMetadata.contestRestrictions[0]!;
        const stored = (await db.query<{ v: { contest_id: number; language: string; version: string; status: string; sources: string[]; summary: string } }>("select to_jsonb(r) v from algopilot_private.recommendation_restrictions r")).rows[0]!.v;
        expect(stored).toMatchObject({ contest_id: expected.contestId, language: expected.language, version: teachingMetadata.version, status: expected.status, sources: expected.sources, summary: expected.summary });
        for (const uid of [undefined, bob]) await expect(query(db, "update algopilot_private.recommendation_restrictions set language='C++'", [], uid)).rejects.toMatchObject({ code: '42501' });
        await expect(query(db, "select public.learning_candidates($1)", [JSON.stringify({ ...q, allowInteractive: true })])).rejects.toMatchObject({ code: '23514' });
        const settings = (await db.query<{ rls: boolean }>("select relrowsecurity rls from pg_class where oid='algopilot_private.recommendation_restrictions'::regclass")).rows[0]!;
        expect(settings.rls).toBe(true);
        await expect(db.exec(patch)).rejects.toMatchObject({ code: '42P07' }); await db.exec('rollback');
        expect(await read(q)).toEqual(pool); // Raw 009 DDL is not replayable; failure must be atomic.
    });
    it("scores source-backed core and related tasks with uncertainty, rather than equating every tag with core", () => {
        const p = candidate(1487, 'C', ['graphs', 'math', 'constructive algorithms']);
        expect(topicMatch(p, 'graphs')).toMatchObject({ strength: 0.25, basis: 'related' }); expect(topicMatch(p, 'math')).toMatchObject({ strength: 1, basis: 'source_checked' });
        expect(topicMatch(candidate(5000, 'A', ['graphs']), 'graphs')).toMatchObject({ strength: 0.75, basis: 'tags_only' });
        const e = scenarios([]).find(s => s.id === 'graphs')!.e;
        const r = recommend(e, [{ ...p, tags: ['graphs'] }, candidate(690, 'C2', ['graphs', 'trees']), candidate(5000, 'A', ['graphs'])]);
        expect(r.items.map(i => i.problem.contestId)).toEqual([690, 5000, 1487]);
        expect(r.items.map(i => i.factors.weakness)).toEqual([22, 16.5, 5.5]);
        expect(r.items[0]!.reasons.join()).toContain('AI 来源核验'); expect(r.items[1]!.reasons.join()).toContain('0.75'); expect(r.items[2]!.reasons.join()).toContain('0.25');
        expect(JSON.stringify(r.items)).not.toContain('"tags"'); expect(r.items.map(i => i.reasons.join()).join()).not.toContain('graphs');
        for (const i of r.items) expect(i.score).toBe(Object.values(i.factors).reduce((a, b) => a + b, 0));
        e.preferences!.themes = ['graphs']; e.preferences!.goal = 'balanced';
        expect(recommend(e, [p]).items[0]!.factors.goal).toBe(4);
        expect(trainingCompatibility(candidate(130, 'A', []))).toBe('language_not_cpp');
        expect(trainingCompatibility(candidate(999, 'A', ['*special']))).toBe('special_unverified');
        expect(recommend(e, [candidate(999, 'A', ['graphs', 'interactive'])]).items).toEqual([]);
    });
    it("same beginner problems have context-dependent adaptation, with no promotion inferred from self-reported count alone", () => {
        const pool = [candidate(29, 'A', ['brute force'], 1000), candidate(672, 'B', ['strings', 'implementation'], 1000)];
        const cold = emptyEvidence(), beginner = scenarios([]).find(s => s.id === 'beginner')!.e;
        expect(recommend(cold, pool).target).toBe(1000); expect(recommend(beginner, pool).target).toBe(1000);
        expect(recommend(cold, pool).items[0]!.refs).toHaveLength(0); expect(recommend(beginner, pool).items[0]!.refs.length).toBeGreaterThan(0);
        const higher = { ...beginner, sessions: [training(1, 1200), training(2, 1200), training(3, 1200)] };
        expect(recommend(higher, pool).items[0]!.factors.difficulty).toBeLessThan(recommend(beginner, pool).items[0]!.factors.difficulty);
        const hintDependent = { ...higher, sessions: higher.sessions.map(s => ({ ...s, maxHint: 4 })) };
        expect(recommendationTarget(hintDependent).target).toBe(1100);
        const feedback = { ...beginner, feedback: [{ id: fixtureId(60001), problemId: pool[0]!.id, kind: 'too_easy' as const, rating: 1000, createdAt: '2026-10-14T00:00:00Z' }] };
        expect(recommend(feedback, pool).target).toBe(1100); expect(recommend(feedback, pool).items[0]!.problem.contestId).toBe(672);
        expect(recommendationWeights).toEqual(before.recommendationWeights);
    });
    it("replays all eight players, isolates SQL vs scoring effects, tracks all forty labels and new controls", async () => {
        const { raw, sha256 } = await catalogRecording(), metadata = parseProblemset(JSON.parse(raw)); await publish(db, metadata);
        await db.exec(oldSql); const seed = (await read(q)).items;
        const matrix: { scenario: string; oldEligible: number; newEligible: number; oldShortlist: number; newShortlist: number; oldCoverage: number; newCoverage: number; runs: Record<'before' | 'filterOnly' | 'after', { keys: string[] }>; costs: Record<string, { medianMs: number; p95Ms: number }> }[] = [];
        for (const scenario of scenarios(seed)) {
            const { preferences: p, target } = recommendationTarget(scenario.e), input = { min: p.min, max: p.max, target, themes: p.themes, repeat: p.repeat };
            await db.exec(oldSql); const oldPool = await read(input); await db.exec(replacement); const newPool = await read(input);
            // Same original plan/history flags applied to both pools by problem key, never by changed pool position.
            const plans = new Set(oldPool.items.filter((_, i) => scenario.id === 'extensive' && i % 3 === 0).map(c => c.id));
            const prepare = (rows: LearningCandidate[]) => rows.map(c => ({ ...c, inPlan: plans.has(c.id), practiced: scenario.e.sessions.some(s => s.problemId === c.id) }));
            const a = prepare(oldPool.items), b = prepare(newPool.items), original = before.recommend(scenario.e, a), filterOnly = before.recommend(scenario.e, b);
            const runs = [original, filterOnly, recommend(scenario.e, b)];
            const keys = (r: { items: { problem: { contestId: number; index: string } }[] }) => r.items.map(i => `${i.problem.contestId}/${i.problem.index}`);
            expect(recommend(scenario.e, [...b].reverse())).toEqual(runs[2]);
            const known = new Set([...scenario.e.sessions, ...scenario.e.reviews, ...scenario.e.feedback].map(r => r.id));
            const metrics = runs.map(r => ({ keys: keys(r), ratings: r.items.map(i => i.problem.rating), target: r.target,
                tags: [...new Set(r.items.flatMap(i => b.find(c => c.id === i.problem.id)?.tags ?? a.find(c => c.id === i.problem.id)!.tags))].sort(),
                incompatible: r.items.filter(i => ['interactive', 'language_not_cpp'].includes(trainingCompatibility(b.find(c => c.id === i.problem.id) ?? a.find(c => c.id === i.problem.id)!))).length,
                coreMatch: ['graphs', 'dp'].includes(scenario.id) ? r.items.map(i => ({ key: `${i.problem.contestId}/${i.problem.index}`, ...topicMatch(b.find(c => c.id === i.problem.id) ?? a.find(c => c.id === i.problem.id)!, scenario.id) })) : [],
                duplicates: r.items.length - new Set(keys(r)).size, completed: r.items.filter(i => scenario.e.sessions.some(s => s.problemId === i.problem.id && s.outcome === 'solved_self_reported')).length,
                planned: r.items.filter(i => i.inPlan).length, badRefs: r.items.flatMap(i => i.refs).filter(r => !known.has(r.id)).length, items: r.items }));
            expect(metrics[2]).toMatchObject({ incompatible: 0, duplicates: 0, completed: 0, badRefs: 0, planned: 0 });
            expect(metrics[2]!.ratings.every(n => n !== null && n >= p.min && n <= p.max)).toBe(true);
            const costs: Record<string, { medianMs: number; p95Ms: number }> = {};
            for (const [name, fn] of [['before', before.recommend], ['after', recommend]] as const) {
                const times = Array.from({ length: 12 }, () => { const start = performance.now(); fn(scenario.e, b); return performance.now() - start; }).slice(2).sort((a, b) => a - b);
                costs[name] = { medianMs: (times[4]! + times[5]!) / 2, p95Ms: times[9]! };
            }
            matrix.push({ scenario: scenario.id, oldEligible: oldPool.total, newEligible: newPool.total, oldShortlist: a.length, newShortlist: b.length, oldCoverage: a.length / oldPool.total, newCoverage: b.length / newPool.total, runs: { before: metrics[0]!, filterOnly: metrics[1]!, after: metrics[2]! }, costs });
        }
        const recorded = JSON.parse(await readFile('docs/m321/recorded-catalog-scenarios.json', 'utf8')) as { matrix: { id: string; items: { problem: { contestId: number; index: string } }[] }[] };
        // Original evaluation's extensive seed used target 1600 (same q), so all 40 must reproduce.
        for (const row of recorded.matrix) expect(matrix.find(m => m.scenario === row.id)!.runs.before!.keys).toEqual(row.items.map(i => `${i.problem.contestId}/${i.problem.index}`));
        const problemRows = recorded.matrix.flatMap(row => row.items.map(i => { const key = `${i.problem.contestId}/${i.problem.index}`, m = matrix.find(m => m.scenario === row.id)!; return { scenario: row.id, key, retained: m.runs.after!.keys.includes(key), compatibility: trainingCompatibility({ ...i.problem, tags: metadata.find(p => p.contestId === i.problem.contestId && p.index === i.problem.index)!.tags }), match: ['graphs', 'dp'].includes(row.id) ? topicMatch({ ...i.problem, tags: metadata.find(p => p.contestId === i.problem.contestId && p.index === i.problem.index)!.tags }, row.id) : null }; }));
        expect(problemRows).toHaveLength(40);
        const reviews = parseCsv(await readFile('docs/m321/ai-assisted-review.csv', 'utf8'));
        const paired = reviews.map(r => ({ assessment: r.assessment, ...problemRows.find(p => p.scenario === r.scenario && p.key === r.problem_key)! }));
        expect(paired.filter(p => p.assessment === '适合')).toHaveLength(33);
        expect(paired.filter(p => p.assessment === '适合').every(p => p.retained)).toBe(true);
        expect(paired.filter(p => p.assessment === '偏简单').every(p => p.retained)).toBe(true);
        expect(paired.filter(p => p.assessment === '方向不符').every(p => !p.retained)).toBe(true);
        const controls = ['690/C1', '1526/C1', '264/B'].map(key => { const p = metadata.find(p => `${p.contestId}/${p.index}` === key)!; return { key, compatibility: trainingCompatibility(p), graph: topicMatch(p, 'graphs'), dp: topicMatch(p, 'dp') }; });
        expect(controls[0]!.graph.strength).toBe(1); expect(controls[1]!.dp.strength).toBe(1);
        if (process.env.M322_EVALUATION_OUTPUT) { const out = process.env.M322_EVALUATION_OUTPUT; await mkdir(out, { recursive: true }); await writeFile(`${out}/comparison.json`, JSON.stringify({ baseline: '3410767', version: 'deterministic/1.2', sha256, catalogSize: metadata.length, annotationVersion: teachingMetadata.version, sourceBoundary: 'Recorded CF metadata and synthetic players; no human benefit verdict', matrix, problemRows, controls }, null, 2) + '\n'); }
    }, 30000);
});
