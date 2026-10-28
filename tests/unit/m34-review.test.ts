import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { reviewSetup, reviewFlow as f, reviewTools, fitValues, followValues } from '../fixtures/m34-review';
import type { ReviewPacket } from '../../scripts/m34-review-core';
const issued = () => { const s = f.validateSetup(reviewSetup()); return { s, b: f.issue(s, 'R-SYNTHETIC', 'P001/0', randomUUID()) }; };
const command = (p: ReviewPacket, rev: number, operation: string, extra = {}) => ({ packet_id: p.packet_id, request_id: randomUUID(), expected_revision: rev, at: '2026-10-28T05:00:00Z', operation, ...extra });
function saved(p: ReviewPacket, values: Record<string, unknown>) { return f.event(p, [], command(p, 0, 'save', { changes: Object.fromEntries(p.lists.flatMap(l => l.items.map(i => [i.item_id, values]))) })).event; }
function submitted(p: ReviewPacket, values: Record<string, unknown>) { const first = saved(p, values); return [first, f.event(p, [first], command(p, 1, 'submit', { confirm_complete: true })).event]; }
it('requires fresh frozen/validated cases, complete materials and registered reviewer ownership', () => { expect(f.validateSetup(reviewSetup()).input.data_source).toBe('synthetic'); for (const kind of ['version', 'missing', 'owner', 'duplicate', 'answer']) {
    const v = reviewSetup();
    if (kind === 'version')
        v.freeze.rules.criteria = 'bad';
    if (kind === 'missing')
        v.materials.pop();
    if (kind === 'owner')
        v.freeze.frozen.reviewers[0]!.participant_id = 'P999';
    if (kind === 'duplicate')
        v.assignments.push({ ...v.assignments[0]! });
    if (kind === 'answer')
        v.materials[0]!.statement = '完整题解';
    expect(() => f.validateSetup(v)).toThrow();
} });
it('fit packet has no reasons, private roster, seed, A/B identity, peers or source history', () => { const { s, b } = issued(), text = JSON.stringify(b.packet); expect(text).not.toMatch(/REASON SENTINEL|actual_arm|R-SYNTHETIC|P001|consent|enrollmentIndex|personalized|baseline|sharedCandidate/); expect(b.packet.source).toBe('synthetic'); expect(b.packet.lists.map(l => l.label)).toEqual(s.input.blocks[0]!.prepared.order.split('').map(a => s.input.blocks[0]!.masked_arms.X === a ? 'X' : 'Y')); expect(f.render(b.packet, f.state(b.packet, []))).toContain('SYNTHETIC'); });
it('partial drafts restore but cannot become formal through a repeated click or missing confirmation', () => { const { b } = issued(), p = b.packet, i = p.lists[0]!.items[0]!.item_id; const first = f.event(p, [], command(p, 0, 'save', { changes: { [i]: { suitability: '适合' } } })).event; expect(f.state(p, [first])).toMatchObject({ revision: 1, draft: { [i]: { suitability: '适合' } }, submissions: [] }); expect(() => f.event(p, [first], command(p, 1, 'submit', { confirm_complete: true }))).toThrow('INCOMPLETE_OR_INVALID'); expect(() => f.event(p, [first], command(p, 1, 'submit'))).toThrow('EXPLICIT_SUBMISSION_REQUIRED'); });
it('wrong fields, enum scores and cases are rejected without filling blanks', () => { const p = issued().b.packet, id = p.lists[0]!.items[0]!.item_id; for (const values of [{ suitability: 5 }, { actual_arm: 'A' }, { goal_match: 0 }])
    expect(() => f.event(p, [], command(p, 0, 'save', { changes: { [id]: values } }))).toThrow(); expect(() => f.event(p, [], command(p, 0, 'save', { changes: { [randomUUID()]: fitValues } }))).toThrow('UNKNOWN_ITEM'); });
it('same request is idempotent, changed body or stale revision conflicts', () => { const p = issued().b.packet, e = saved(p, fitValues); expect(f.event(p, [e], e.command)).toMatchObject({ replayed: true, event: e }); expect(() => f.event(p, [e], { ...e.command, at: '2026-10-28T06:00:00Z' })).toThrow('REQUEST_CONFLICT'); expect(() => f.event(p, [e], command(p, 0, 'submit', { confirm_complete: true }))).toThrow('REVISION_CONFLICT'); });
it('explicit nulls are valid UNKNOWN, never manufactured as zero', () => { const p = issued().b.packet, events = submitted(p, { suitability: null, difficulty: null, goal_match: null }); expect(f.state(p, events).submissions[0]!.values[p.lists[0]!.items[0]!.item_id]).toEqual({ suitability: null, difficulty: null, goal_match: null }); });
it('corrections append immutable snapshots and must name the latest submission', () => { const p = issued().b.packet, events = submitted(p, fitValues), before = JSON.stringify(events), i = p.lists[0]!.items[0]!.item_id; const correction = f.event(p, events, command(p, 2, 'correct', { at: '2026-10-28T06:00:00Z', supersedes: events[1]!.command.request_id, confirm_complete: true, changes: { [i]: { suitability: '偏困难' } } })).event; const state = f.state(p, [...events, correction]); expect(state.submissions).toHaveLength(2); expect(state.submissions[0]!.values[i]!.suitability).toBe('适合'); expect(state.submissions[1]!.supersedes).toBe(state.submissions[0]!.id); expect(JSON.stringify(events)).toBe(before); expect(() => f.event(p, events, command(p, 2, 'correct', { supersedes: randomUUID(), confirm_complete: true, changes: { [i]: { suitability: '偏困难' } } }))).toThrow('STALE_SUBMISSION'); });
it('release requires formal fit completion and locks that phase before showing reasons', () => { const { s, b } = issued(), p = b.packet; expect(() => f.followup(s, b, f.state(p, []))).toThrow('FIT_NOT_SUBMITTED'); const events = submitted(p, fitValues), release = f.event(p, events, { ...command(p, 2, 'release'), at: '2026-10-28T06:00:00Z' }, true).event; const fit = f.state(p, [...events, release]), follow = f.followup(s, b, fit); expect(f.checkPacket(follow).phase).toBe('followup'); expect(JSON.stringify(follow)).toContain('REASON SENTINEL'); expect(() => f.event(p, [...events, release], command(p, 3, 'save', { at: '2026-10-28T07:00:00Z', changes: { [p.lists[0]!.items[0]!.item_id]: fitValues } }))).toThrow('FIT_SEALED'); });
it('reviewer input cannot call the private release operation', () => { const p = issued().b.packet; expect(() => f.event(p, [], command(p, 0, 'release'))).toThrow('INVALID_FIELDS'); });
it('packet/schema/hash tampering and corrupt journal chains are rejected', () => { const p = issued().b.packet, e = saved(p, fitValues); expect(() => f.checkPacket({ ...p, criteria_version: 'bad' })).toThrow(); expect(() => f.checkPacket({ ...p, actual_arm: 'A' })).toThrow(); expect(() => f.state(p, [{ ...e, sequence: 2 }])).toThrow('JOURNAL_CHANGED'); expect(() => f.state({ ...p, goal: 'explore' }, [e])).toThrow('PACKET_CHANGED'); });
it('a different reviewer has independent tokens, state and submission IDs', () => { const s = f.validateSetup(reviewSetup(true)), a = f.issue(s, 'R-SYNTHETIC', 'P001/0', randomUUID()), b = f.issue(s, 'T-SYNTHETIC', 'P001/0', randomUUID()); expect(a.packet.reviewer_token).not.toBe(b.packet.reviewer_token); const e = saved(a.packet, fitValues); expect(() => f.event(b.packet, [], e.command)).toThrow('PACKET_MISMATCH'); expect(f.state(b.packet, []).draft).toEqual({}); });
it('completed followup observations match the unchanged M3.4 schema, including independent teacher rows', () => { for (const teacher of [false, true]) {
    const s = f.validateSetup(reviewSetup(teacher)), b = f.issue(s, teacher ? 'T-SYNTHETIC' : 'R-SYNTHETIC', 'P001/0', randomUUID()), fit = f.state(b.packet, submitted(b.packet, fitValues)), p = f.followup(s, b, fit), v = teacher ? { reason_supported: false } : followValues, events = submitted(p, v);
    const rows = f.observations(s, b, fit, p, f.state(p, events));
    expect(rows).toHaveLength(2);
    expect(rows.every(r => reviewTools.observationSchema.safeParse(r).success)).toBe(true);
    expect(rows.every(r => r.official_verdict === null && r.source_match === 'unverified')).toBe(true);
    if (teacher)
        expect(rows.every(r => r.highest_hint_seen === null)).toBe(true);
} });
it('followup corrections become explicit supersedes events rather than overwriting results', () => { const { s, b } = issued(), fit = f.state(b.packet, submitted(b.packet, fitValues)), p = f.followup(s, b, fit), events = submitted(p, followValues); const i = p.lists[0]!.items[0]!.item_id; const correction = f.event(p, events, command(p, 2, 'correct', { at: '2026-10-28T06:00:00Z', confirm_complete: true, supersedes: events[1]!.command.request_id, changes: { [i]: { reason_supported: false } } })).event; const rows = f.observations(s, b, fit, p, f.state(p, [...events, correction])); expect(rows).toHaveLength(4); expect(rows[2]!.supersedes_event_id).toBe(rows[0]!.event_id); expect(rows[0]!.event_id).not.toBe(rows[2]!.event_id); });
it('no distinct pair preserves list work without fabricating a paired result', () => { const setup = reviewSetup(); setup.freeze.frozen.blocks[0]!.pair = null as never; const s = f.validateSetup(setup), b = f.issue(s, 'R-SYNTHETIC', 'P001/0', randomUUID()), fit = f.state(b.packet, submitted(b.packet, fitValues)), p = f.followup(s, b, fit); expect(p.lists.every(l => l.items.every(i => !i.training))).toBe(true); const events = submitted(p, { reason_supported: true }); expect(f.observations(s, b, fit, p, f.state(p, events))).toEqual([]); });

it('error field paths do not echo unrecognized private record keys', () => {
    const p=issued().b.packet;
    try { f.event(p, [], command(p,0,'save',{changes:{'SYNTHETIC-PRIVATE-KEY-DO-NOT-ECHO':fitValues}})); throw new Error('expected rejection'); }
    catch(e) { expect(e).toHaveProperty('code','INVALID_FIELDS'); expect(JSON.stringify(e)).not.toContain('SYNTHETIC-PRIVATE-KEY-DO-NOT-ECHO'); expect(e).toHaveProperty('fields',['changes.$unknown']); }
});
