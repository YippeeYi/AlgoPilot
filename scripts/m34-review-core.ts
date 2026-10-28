// Offline execution workflow only. No product routes, model calls or research-policy changes.
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { observationSchema, resultsInputSchema, inspectStudy, conditionsHash, renderStudyReport, StudyObservation } from './m34-results';
import type { prepareStudy } from './m34-study';
import type { verifyReplay, semanticDigest } from './m34-replay-core';
export type ReviewTools = {
    observationSchema: typeof observationSchema;
    resultsInputSchema: typeof resultsInputSchema;
    inspectStudy: typeof inspectStudy;
    prepareStudy: typeof prepareStudy;
    conditionsHash: typeof conditionsHash;
    renderStudyReport: typeof renderStudyReport;
    verifyReplay: typeof verifyReplay;
    semanticDigest: typeof semanticDigest;
};
export class ReviewError extends Error {
    code: string;
    fields: string[];
    constructor(code: string, fields: string[] = []) { super(code); this.code = code; this.fields = fields; }
}
const id = z.uuid(), at = z.iso.datetime(), caseId = z.string().regex(/^P[0-9]{3,6}\/[01]$/), key = z.string().regex(/^[1-9][0-9]*\/[A-Z0-9]{1,12}$/);
const text = z.string().min(1).max(12000).refine(v => Array.from(v).every(c => { const n = c.codePointAt(0)!; return n >= 32 && n !== 127 || [9, 10, 13].includes(n); }));
const material = z.object({ case_id: caseId, arm: z.enum(['A', 'B']), problem_key: key, statement: text, reason: text, source: z.enum(['synthetic', 'authorized_local']), blindness_checked: z.literal(true), no_solution_checked: z.literal(true) }).strict();
export const reviewSetupSchema = z.object({ version: z.literal('m34-review-setup/1'), freeze: z.unknown(), assignments: z.array(z.object({ reviewer_id: z.string(), case_id: caseId }).strict()).min(1).max(1000), materials: z.array(material).min(1).max(10000) }).strict();
const item = z.object({ item_id: id, problem_key: key, rating: z.number().int(), statement: text, source: z.enum(['synthetic', 'authorized_local']), reason: text.optional(), training: z.boolean().optional() }).strict();
export const packetSchema = z.object({ version: z.literal('m34-review-packet/1'), criteria_version: z.literal('m34-observation/1'), freeze_version: z.literal('m34-freeze/1'), freeze_ref: id, case_token: id, reviewer_token: id, packet_id: id, parent_packet: id.nullable(), source: z.enum(['synthetic', 'declared_human']), role: z.enum(['participant', 'teacher']), phase: z.enum(['fit', 'followup']), not_before: at, goal: z.enum(['balanced', 'independence', 'explore']), conditions: z.object({ time_limit_minutes: z.number(), highest_allowed_hint: z.number() }).strict(), lists: z.array(z.object({ label: z.enum(['X', 'Y']), items: z.array(item).min(1).max(5) }).strict()).length(2), fit_receipt_hash: z.string().nullable(), packet_hash: z.string() }).strict();
export type ReviewPacket = z.infer<typeof packetSchema>;
export type Setup = z.infer<typeof reviewSetupSchema>;
export type ReviewState = {
    revision: number;
    draft: Record<string, Record<string, unknown>>;
    submissions: {
        id: string;
        at: string;
        supersedes: string | null;
        values: Record<string, Record<string, unknown>>;
        revision: number;
    }[];
    released: boolean;
    release_at: string | null;
};
export type ReviewEvent = {
    version: 'm34-review-event/1';
    sequence: number;
    previous_hash: string | null;
    packet_hash: string;
    command: ReviewCommand;
    hash: string;
};
export const reviewCommandSchema = z.object({ packet_id: id, request_id: id, expected_revision: z.number().int().nonnegative(), at, operation: z.enum(['save', 'submit', 'correct']), changes: z.record(id, z.record(z.string(), z.unknown())).optional(), supersedes: id.optional(), confirm_complete: z.boolean().optional() }).strict();
type ReviewCommand = z.infer<typeof reviewCommandSchema> | {
    packet_id: string;
    request_id: string;
    expected_revision: number;
    at: string;
    operation: 'release';
};
const requireValue = (yes: unknown, code: string, fields: string[] = []) => { if (!yes)
    throw new ReviewError(code, fields); };
// Zod record-key paths can contain untrusted input. Report only contract names or opaque UUIDs.
const safeFieldNames = new Set(('version freeze assignments materials reviewer_id case_id arm problem_key statement reason source blindness_checked no_solution_checked criteria_version freeze_version freeze_ref case_token reviewer_token packet_id parent_packet role phase not_before goal conditions time_limit_minutes highest_allowed_hint lists label items item_id rating training fit_receipt_hash packet_hash request_id expected_revision at operation changes supersedes confirm_complete suitability difficulty goal_match reason_supported previously_seen missing_prerequisite highest_hint_seen external_help stopped duration_minutes outcome_self_report protocol_deviation').split(' '));
function safeFieldPath(path:PropertyKey[]) { return path.map(p => typeof p === 'number' || typeof p === 'string' && (safeFieldNames.has(p) || z.uuid().safeParse(p).success) ? String(p) : '$unknown').join('.') || '$'; }
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { const r = schema.safeParse(raw); if (!r.success)
    throw new ReviewError('INVALID_FIELDS', r.error.issues.slice(0, 30).map(i => safeFieldPath(i.path))); return r.data; }
const codewords = /AlgoPilot|deterministic\/|\bpersonalized\b|\bbaseline\b|实验组|对照组|完整题解|完整解法|editorial/i;
export function createReviewWorkflow(tools: ReviewTools) {
    const fit = tools.observationSchema.pick({ suitability: true, difficulty: true, goal_match: true }).strict();
    const follow = tools.observationSchema.pick({ reason_supported: true, previously_seen: true, missing_prerequisite: true, highest_hint_seen: true, external_help: true, stopped: true, duration_minutes: true, outcome_self_report: true, protocol_deviation: true }).strict();
    const reasonOnly = tools.observationSchema.pick({ reason_supported: true }).strict();
    const hash = tools.semanticDigest;
    const seal = (p: Omit<ReviewPacket, 'packet_hash'>): ReviewPacket => ({ ...p, packet_hash: hash(p) });
    function checkPacket(raw: unknown) {
        const p = parse(packetSchema, raw), { packet_hash, ...body } = p;
        requireValue(hash(body) === packet_hash, 'PACKET_CHANGED');
        requireValue(p.lists[0]!.label !== p.lists[1]!.label, 'INVALID_MASKED_LISTS');
        const ids = p.lists.flatMap(l => l.items.map(i => i.item_id));
        requireValue(new Set(ids).size === ids.length, 'DUPLICATE_ITEM');
        for (const i of p.lists.flatMap(l => l.items)) {
            requireValue(!codewords.test(i.statement), 'IDENTITY_OR_SOLUTION_IN_MATERIAL');
            if (p.phase === 'fit')
                requireValue(i.reason === undefined && i.training === undefined, 'EARLY_DISCLOSURE');
            else
                requireValue(i.reason !== undefined && i.training !== undefined && !codewords.test(i.reason), 'INVALID_FOLLOWUP_MATERIAL');
        }
        return p;
    }
    function validateSetup(raw: unknown) {
        const s = parse(reviewSetupSchema, raw), f = (s.freeze as {
            frozen?: unknown;
        })?.frozen, base = tools.inspectStudy(f);
        requireValue(base.ledger, 'INVALID_FREEZE');
        const r = tools.verifyReplay(s.freeze, f, base.result, tools.renderStudyReport(base.result), tools);
        requireValue(r.integrity === 'PASS', 'FREEZE_MISMATCH');
        const v = base.ledger!.input;
        requireValue(v.observations.length === 0 && v.blocks.every(b => b.unblinded_at === null), 'NOT_A_FRESH_BLINDED_STUDY');
        const seen = new Set<string>(), primary = new Set<string>();
        for (const a of s.assignments) {
            const b = v.blocks.find(b => b.prepared.participantId + '/' + b.prepared.block === a.case_id), reviewer = v.reviewers.find(r => r.id === a.reviewer_id);
            requireValue(b && reviewer && reviewer.kind !== 'ai' && reviewer.verified && b.provenance_verified && b.consent_status === 'active' && !v.blocks.some(x => x.prepared.participantId === b.prepared.participantId && x.consent_status === 'withdrawn'), 'INVALID_ASSIGNMENT');
            requireValue(reviewer!.kind !== 'participant' || reviewer!.participant_id === b!.prepared.participantId, 'REVIEWER_OWNER_MISMATCH');
            const k = a.case_id + '/' + a.reviewer_id;
            requireValue(!seen.has(k), 'DUPLICATE_ASSIGNMENT');
            seen.add(k);
            if (reviewer!.kind === 'participant') {
                requireValue(!primary.has(a.case_id), 'AMBIGUOUS_PRIMARY');
                primary.add(a.case_id);
            }
        }
        const expected = new Map<string, {
            rating: number;
        }>();
        for (const b of v.blocks)
            for (const arm of ['A', 'B'] as const)
                for (const p of b.prepared[arm === 'A' ? 'personalized' : 'baseline'])
                    expected.set(`${b.prepared.participantId}/${b.prepared.block}:${arm}:${p.contestId}/${p.index}`, p);
        const materials = new Set<string>(), statements = new Map<string, string>();
        for (const m of s.materials) {
            const k = m.case_id + ':' + m.arm + ':' + m.problem_key;
            requireValue(expected.has(k) && !materials.has(k), 'UNKNOWN_OR_DUPLICATE_MATERIAL');
            materials.add(k);
            requireValue(m.source === (v.data_source === 'synthetic' ? 'synthetic' : 'authorized_local'), 'SOURCE_MISMATCH');
            requireValue(!codewords.test(m.statement) && !codewords.test(m.reason), 'IDENTITY_OR_SOLUTION_IN_MATERIAL');
            const same = m.case_id + ':' + m.problem_key;
            requireValue(!statements.has(same) || statements.get(same) === m.statement, 'UNEQUAL_SHARED_STATEMENT');
            statements.set(same, m.statement);
        }
        requireValue([...expected.keys()].every(k => materials.has(k)), 'MISSING_MATERIAL');
        return { setup: s, input: v, setup_hash: hash(s) };
    }
    function issue(s: ReturnType<typeof validateSetup>, reviewerId: string, case_id: string, freeze_ref: string, issuedAt?: string) {
        const b = s.input.blocks.find(b => b.prepared.participantId + '/' + b.prepared.block === case_id), reviewer = s.input.reviewers.find(r => r.id === reviewerId);
        requireValue(s.setup.assignments.some(a => a.case_id === case_id && a.reviewer_id === reviewerId) && b && reviewer, 'UNKNOWN_ASSIGNMENT');
        const mapping: Record<string, {
            arm: 'A' | 'B';
            problem_key: string;
        }> = {}, lists: ReviewPacket['lists'] = [];
        for (const arm of b!.prepared.order.split('') as ('A' | 'B')[]) {
            const label = b!.masked_arms.X === arm ? 'X' : 'Y';
            const items = b!.prepared[arm === 'A' ? 'personalized' : 'baseline'].map(p => { const problem_key = p.contestId + '/' + p.index, m = s.setup.materials.find(m => m.case_id === case_id && m.arm === arm && m.problem_key === problem_key)!; const item_id = randomUUID(); mapping[item_id] = { arm, problem_key }; return { item_id, problem_key, rating: p.rating, statement: m.statement, source: m.source }; });
            lists.push({ label, items });
        }
        const packet = seal({ version: 'm34-review-packet/1', criteria_version: 'm34-observation/1', freeze_version: 'm34-freeze/1', freeze_ref, case_token: randomUUID(), reviewer_token: randomUUID(), packet_id: randomUUID(), parent_packet: null, source: s.input.data_source, role: reviewer!.kind as 'participant' | 'teacher', phase: 'fit', not_before: issuedAt ?? b!.frozen_at, goal: b!.prepared.goal, conditions: { time_limit_minutes: b!.conditions.time_limit_minutes, highest_allowed_hint: b!.conditions.highest_allowed_hint }, lists, fit_receipt_hash: null });
        return { packet, mapping, case_id, reviewer_id: reviewerId };
    }
    function itemSchema(p: ReviewPacket, itemId: string) { const i = p.lists.flatMap(l => l.items).find(i => i.item_id === itemId); requireValue(i, 'UNKNOWN_ITEM', ['items.' + itemId]); return p.phase === 'fit' ? fit : p.role === 'participant' && i!.training ? follow : reasonOnly; }
    function state(packet: ReviewPacket, events: ReviewEvent[]): ReviewState { const p = checkPacket(packet), s: ReviewState = { revision: 0, draft: {}, submissions: [], released: false, release_at: null }; let previous: string | null = null; for (const e of events) {
        requireValue(e.version === 'm34-review-event/1' && e.sequence === s.revision + 1 && e.previous_hash === previous && e.packet_hash === p.packet_hash && hash({ ...e, hash: undefined }) === e.hash, 'JOURNAL_CHANGED');
        transition(p, s, e.command, true);
        s.revision++;
        previous = e.hash;
    } return s; }
    function transition(p: ReviewPacket, s: ReviewState, c: ReviewCommand, control = false) {
        requireValue(c.packet_id === p.packet_id, 'PACKET_MISMATCH');
        requireValue(c.expected_revision === s.revision, 'REVISION_CONFLICT');
        requireValue(!s.released, 'FIT_SEALED');
        requireValue(Date.parse(c.at) >= Date.parse(p.not_before), 'BEFORE_PACKET_RELEASE');
        const last = s.submissions.at(-1);
        if (c.operation === 'release') {
            requireValue(control && p.phase === 'fit' && last, 'INVALID_RELEASE');
            s.released = true;
            s.release_at = c.at;
            return;
        }
        const cmd = parse(reviewCommandSchema, c);
        if (cmd.operation === 'save')
            requireValue(cmd.supersedes === undefined && cmd.confirm_complete === undefined, 'INVALID_SAVE_FIELDS');
        if (cmd.operation === 'submit')
            requireValue(cmd.changes === undefined && cmd.supersedes === undefined, 'INVALID_SUBMIT_FIELDS');
        if (cmd.operation === 'save' || cmd.operation === 'correct') {
            requireValue(cmd.changes && Object.keys(cmd.changes).length, 'EMPTY_PATCH');
            for (const [itemId, change] of Object.entries(cmd.changes!)) {
                const schema = itemSchema(p, itemId);
                const valid = parse<Record<string, unknown>>(schema.partial(), change);
                s.draft[itemId] = { ...s.draft[itemId], ...valid };
            }
        }
        if (cmd.operation === 'submit' || cmd.operation === 'correct') {
            requireValue(cmd.confirm_complete === true, 'EXPLICIT_SUBMISSION_REQUIRED');
            requireValue(cmd.operation === 'correct' ? last && cmd.supersedes === last.id : !last, cmd.operation === 'correct' ? 'STALE_SUBMISSION' : 'ALREADY_SUBMITTED');
            const values: ReviewState['draft'] = {};
            for (const i of p.lists.flatMap(l => l.items)) {
                try {
                    values[i.item_id] = parse<Record<string, unknown>>(itemSchema(p, i.item_id), s.draft[i.item_id] ?? {});
                }
                catch (e) {
                    if (e instanceof ReviewError)
                        throw new ReviewError('INCOMPLETE_OR_INVALID_ASSESSMENT', e.fields.map(f => 'items.' + i.item_id + '.' + f));
                    throw e;
                }
            }
            if (last)
                requireValue(hash(values) !== hash(last.values), 'NO_CHANGES');
            requireValue(!last || Date.parse(cmd.at) > Date.parse(last.at), 'NON_MONOTONIC_CORRECTION');
            s.submissions.push({ id: cmd.request_id, at: cmd.at, supersedes: last?.id ?? null, values, revision: s.revision + 1 });
        }
    }
    function event(packet: ReviewPacket, events: ReviewEvent[], raw: unknown, release = false) { const p = checkPacket(packet), command = release ? raw as ReviewCommand : parse(reviewCommandSchema, raw), fingerprint = hash(command); const s = state(p, events); const old = events.find(e => e.command.request_id === command.request_id); if (old) {
        requireValue(hash(old.command) === fingerprint, 'REQUEST_CONFLICT');
        return { event: old, replayed: true };
    } requireValue(!events.length || Date.parse(command.at) >= Date.parse(events.at(-1)!.command.at), 'NON_MONOTONIC_COMMAND'); transition(p, s, command, release); const body = { version: 'm34-review-event/1' as const, sequence: events.length + 1, previous_hash: events.at(-1)?.hash ?? null, packet_hash: p.packet_hash, command }; return { event: { ...body, hash: hash({ ...body, hash: undefined }) }, replayed: false }; }
    function followup(s: ReturnType<typeof validateSetup>, binding: ReturnType<typeof issue>, fitState: ReviewState, releasedAt?: string) {
        const last = fitState.submissions.at(-1);
        requireValue(last, 'FIT_NOT_SUBMITTED');
        const b = s.input.blocks.find(b => b.prepared.participantId + '/' + b.prepared.block === binding.case_id)!;
        const p = binding.packet;
        const { packet_hash, ...body } = p;
        void packet_hash;
        return seal({ ...body, packet_id: randomUUID(), parent_packet: p.packet_id, phase: 'followup', not_before: releasedAt ?? fitState.release_at ?? last!.at, fit_receipt_hash: hash(last), lists: p.lists.map(l => ({ ...l, items: l.items.map(i => { const m = binding.mapping[i.item_id]!, material = s.setup.materials.find(x => x.case_id === binding.case_id && x.arm === m.arm && x.problem_key === m.problem_key)!; return { ...i, reason: material.reason, training: p.role === 'participant' && !!b.pair && b.pair.A !== b.pair.B && b.pair[m.arm] === m.problem_key }; }) })) });
    }
    function observations(s: ReturnType<typeof validateSetup>, binding: ReturnType<typeof issue>, fitState: ReviewState, followPacket: ReviewPacket, followState: ReviewState) {
        checkPacket(followPacket);
        requireValue(followPacket.parent_packet === binding.packet.packet_id && followPacket.reviewer_token === binding.packet.reviewer_token && followPacket.fit_receipt_hash === hash(fitState.submissions.at(-1)), 'FOLLOWUP_BINDING_CHANGED');
        const b = s.input.blocks.find(b => b.prepared.participantId + '/' + b.prepared.block === binding.case_id)!;
        if (!b.pair || b.pair.A === b.pair.B)
            return [];
        const fitValues = fitState.submissions.at(-1)!.values, rows: StudyObservation[] = [];
        const eventId = (submission: string, itemId: string) => { const hex = createHash('sha256').update(followPacket.packet_id + ':' + submission + ':' + itemId).digest('hex'); return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-5' + hex.slice(13, 16) + '-8' + hex.slice(17, 20) + '-' + hex.slice(20, 32); };
        for (const submission of followState.submissions)
            for (const [itemId, m] of Object.entries(binding.mapping)) {
                if (m.problem_key !== b.pair[m.arm])
                    continue;
                const values = submission.values[itemId]!, p = b.prepared;
                const row = { criteria_version: 'm34-observation/1', conditions_hash: tools.conditionsHash(b.conditions), event_id: eventId(submission.id, itemId), supersedes_event_id: submission.supersedes ? eventId(submission.supersedes, itemId) : null, recorded_at: submission.at, reviewer: binding.reviewer_id, review_type: 'human', participant_id: p.participantId, consent_id: p.consentId, consent_version: b.consent_version, block: p.block, order: p.order, masked_arm: b.masked_arms.X === m.arm ? 'X' : 'Y', actual_arm: m.arm, engine_version: p.engineVersion, pool_hash: p.sharedCandidateSha256, metadata_time: b.metadata_time, evidence_revision: p.evidenceRevision, official_revision: p.officialRevision, scenario: b.scenario, problem_key: m.problem_key, pair_id: b.pair.pair_id, ...fitValues[itemId], reason_supported: values.reason_supported, evidence_refs: [], missing_prerequisite: values.missing_prerequisite ?? null, outcome_self_report: values.outcome_self_report ?? null, official_verdict: null, source_match: 'unverified', highest_hint_seen: values.highest_hint_seen ?? null, previously_seen: values.previously_seen ?? null, external_help: values.external_help ?? null, stopped: values.stopped ?? null, duration_minutes: values.duration_minutes ?? null, review_source: null, new_issue: null, issue_confidence: null, withdrawal: false, protocol_deviation: values.protocol_deviation ?? null, suggestion: null };
                rows.push(parse(tools.observationSchema, row));
            }
        return rows;
    }
    function render(packet: ReviewPacket, s: ReviewState) { const p = checkPacket(packet); return [`M3.4 ${p.source === 'synthetic' ? 'SYNTHETIC 合成演练（不计真人）' : '人工来源声明，须另获实际研究授权'}`, `阶段 ${p.phase}；版本 ${p.criteria_version}；冻结版本 ${p.freeze_version}，私有参考 ${p.freeze_ref}`, `进度 revision=${s.revision}，正式版本=${s.submissions.length}，草稿与正式记录分开。`, p.phase === 'fit' ? '先独立评适合程度；本包不含理由、答案或条件身份。' : '初阶段已封存；现在评理由是否有据，并由选手明确记录训练观察。', `适合度：适合/偏简单/偏困难/方向不符/理由缺乏证据；难度：偏简单/适中/偏困难；goal_match与reason_supported为布尔。NULL明确表示UNKNOWN，不是0。`, `正式提交要求每项字段明确填写（可空字段写NULL）；save不会进入正式汇总，correct追加修正不会覆盖。`, `训练共同时限 ${p.conditions.time_limit_minutes} 分钟、最高允许提示 L${p.conditions.highest_allowed_hint}；超限观察保留给协调者判断偏离，不伪造官方AC。`, ...p.lists.flatMap(l => [`列表 ${l.label}`, ...l.items.flatMap(i => [`任务 ${i.item_id}，CF ${i.problem_key}，Rating ${i.rating}，来源 ${i.source}`, i.statement, ...p.phase === 'followup' ? [`理由：${i.reason}`, i.training ? '需选手填写训练观察。' : '本项只评理由。'] : []])])].join('\n\n'); }
    return { validateSetup, issue, checkPacket, state, event, followup, observations, render, fitFields: fit.shape, followFields: follow.shape };
}
