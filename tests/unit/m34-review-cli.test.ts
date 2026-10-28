import { it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { reviewSetup, reviewFlow, fitValues, followValues } from '../fixtures/m34-review';
let driver: ChildProcessWithoutNullStreams, serial = 0, closed = false;
const waiting = new Map<number, (x: Reply) => void>(), dirs: string[] = [];
type Reply = {
    ok: boolean;
    result: Record<string, unknown>;
    error: string;
    fields: string[];
};
beforeAll(() => { driver = spawn(process.execPath, [resolve('tests/fixtures/m34-review-driver.mjs')], { env: process.env }); driver.once('close', () => { closed = true; for (const resolve of waiting.values())
    resolve({ ok: false, error: 'DRIVER_EXIT', result: {}, fields: [] }); waiting.clear(); }); createInterface({ input: driver.stdout }).on('line', line => { const r = JSON.parse(line); waiting.get(r.id)?.(r); waiting.delete(r.id); }); });
afterAll(async () => { if (!closed) {
    driver.stdin.end();
    await new Promise<void>(resolve => driver.once('close', () => resolve()));
} for (const d of dirs)
    await rm(d, { recursive: true, force: true }); });
const call = (...args: string[]) => new Promise<Reply>(resolve => { const id = ++serial; waiting.set(id, resolve); driver.stdin.write(JSON.stringify({ id, args }) + '\n'); });
async function create(teacher = false, modify?: (v: ReturnType<typeof reviewSetup>) => void) { const d = await mkdtemp(join(tmpdir(), 'm34-review-rehearsal-')); dirs.push(d); const s = reviewSetup(teacher); modify?.(s); const setup = join(d, 'setup.json'), privateDir = join(d, 'private'), publicRoot = join(d, 'public'); await writeFile(setup, JSON.stringify(s)); expect((await call('prepare', setup, privateDir)).ok).toBe(true); return { d, s, privateDir, publicRoot, revision: 0 }; }
async function control(c: Awaited<ReturnType<typeof create>>, op: string, body: Record<string, unknown>, at = '2026-10-28T02:00:00Z') { const path = join(c.d, randomUUID() + '.json'), command = { request_id: randomUUID(), expected_revision: c.revision, at, ...body }; await writeFile(path, JSON.stringify(command)); const args = [op, c.privateDir, path, ...['issue', 'release'].includes(op) ? [c.publicRoot] : []], r = await call(...args); if (r.ok)
    c.revision = r.result.revision as number; return { r, path, args, command }; }
async function packet(dir: string) { return JSON.parse(await readFile(join(dir, 'packet.json'), 'utf8')); }
async function apply(dir: string, op: string, changes?: Record<string, unknown>, at = '2026-10-28T05:00:00Z', supersedes?: string) { const v = await call('view', dir); expect(v.ok).toBe(true); const p = await packet(dir), file = join(dir, '..', randomUUID() + '.command-input'); const c = { packet_id: p.packet_id, request_id: randomUUID(), expected_revision: v.result.revision, at, operation: op, ...op === 'save' ? {} : { confirm_complete: true }, ...changes ? { changes } : {}, ...supersedes ? { supersedes } : {} }; await writeFile(file, JSON.stringify(c)); const r = await call('apply', dir, file); return { r, c, file }; }
const all = (p: {
    lists: {
        items: {
            item_id: string;
            training?: boolean;
        }[];
    }[];
}, follow = false, teacher = false) => Object.fromEntries(p.lists.flatMap(l => l.items.map(i => [i.item_id, follow ? teacher || !i.training ? { reason_supported: false } : followValues : fitValues])));
async function fit(dir: string) { const p = await packet(dir); expect((await apply(dir, 'save', all(p))).r.ok).toBe(true); const r = await apply(dir, 'submit'); expect(r.r.ok).toBe(true); return r; }
async function follow(dir: string, teacher = false) { const p = await packet(dir); expect((await apply(dir, 'save', all(p, true, teacher), '2026-10-28T07:00:00Z')).r.ok).toBe(true); const r = await apply(dir, 'submit', undefined, '2026-10-28T07:00:00Z'); expect(r.r.ok).toBe(true); return r; }
it('actual files support blind fit, partial recovery, followup, corrections, deterministic export and both existing CLIs', async () => {
    const c = await create(), issued = await control(c, 'issue', { case_id: 'P001/0', reviewer_id: 'R-SYNTHETIC' }), dir = issued.r.result.packet_dir as string;
    expect(issued.r.ok).toBe(true);
    const p = await packet(dir);
    const files = await readdir(dir);
    expect(files).toEqual(expect.arrayContaining(['packet.json', 'instructions.txt']));
    expect((await readFile(join(dir, 'packet.json'), 'utf8')) + (await readFile(join(dir, 'instructions.txt'), 'utf8'))).not.toMatch(/REASON SENTINEL|actual_arm|R-SYNTHETIC|P001|baseline|personalized/);
    const item = p.lists[0].items[0].item_id;
    expect((await apply(dir, 'save', { [item]: { suitability: '适合' } })).r.ok).toBe(true);
    expect((await apply(dir, 'submit')).r).toMatchObject({ ok: false, error: 'INCOMPLETE_OR_INVALID_ASSESSMENT' });
    const recovered = spawnSync(process.execPath, [resolve('scripts/m34-review.mjs'), 'view', dir], { encoding: 'utf8', env: process.env });
    expect(recovered.status).toBe(0);
    expect(JSON.parse(recovered.stdout).draft[item]).toEqual({ suitability: '适合' });
    await fit(dir);
    const rel = await control(c, 'release', { case_id: 'P001/0', reviewer_id: 'R-SYNTHETIC' }, '2026-10-28T06:00:00Z'), next = rel.r.result.packet_dir as string;
    expect(rel.r.ok).toBe(true);
    expect((await readFile(join(next, 'packet.json'), 'utf8'))).toContain('REASON SENTINEL');
    expect((await apply(dir, 'save', { [item]: { suitability: '偏困难' } }, '2026-10-28T06:30:00Z')).r).toMatchObject({ ok: false, error: 'FIT_SEALED' });
    const submitted = await follow(next);
    const replayed = await call('apply', next, submitted.file);
    expect(replayed.result).toMatchObject({ replayed: true, revision: submitted.r.result.revision });
    const followItem = (await packet(next)).lists[0].items[0].item_id;
    expect((await apply(next, 'correct', { [followItem]: { reason_supported: false } }, '2026-10-28T09:00:00Z', submitted.r.result.receipt as string)).r.ok).toBe(true);
    expect((await control(c, 'unblind', { case_id: 'P001/0' }, '2026-10-28T10:00:00Z')).r.ok).toBe(true);
    const out = join(c.d, 'export-one');
    expect((await call('export', c.privateDir, out)).ok).toBe(true);
    const data = JSON.parse(await readFile(join(out, 'current.json'), 'utf8'));
    expect(data.observations).toHaveLength(4);
    expect(data.observations.filter((r: {
        supersedes_event_id: string | null;
    }) => r.supersedes_event_id)).toHaveLength(2);
    const second = join(c.d, 'export-two');
    expect((await call('export', c.privateDir, second)).ok).toBe(true);
    for (const name of ['current.json', 'results.json', 'report.md', 'replay.json'])
        expect(await readFile(join(out, name), 'utf8')).toBe(await readFile(join(second, name), 'utf8'));
    const old = spawnSync(process.execPath, [resolve('scripts/m34-results.ts'), join(out, 'current.json'), join(c.d, 'old-cli')], { encoding: 'utf8', env: process.env });
    expect(old.status).toBe(0);
    expect(await readFile(join(c.d, 'old-cli/report.md'), 'utf8')).toBe(await readFile(join(out, 'report.md'), 'utf8'));
    await writeFile(join(c.d, 'freeze.json'), JSON.stringify(c.s.freeze));
    const verified = spawnSync(process.execPath, [resolve('scripts/m34-replay.mjs'), join(c.d, 'freeze.json'), join(out, 'current.json'), out, join(c.d, 'verified-cli')], { encoding: 'utf8', env: process.env });
    expect(verified.status).toBe(0);
    expect(JSON.parse(await readFile(join(c.d, 'verified-cli/replay.json'), 'utf8')).integrity).toBe('PASS');
});
it('different reviewers do not merge, incomplete followup is omitted, and withdrawal stops new collection and stale reuse', async () => {
    const c = await create(true), a = await control(c, 'issue', { case_id: 'P001/0', reviewer_id: 'R-SYNTHETIC' }), b = await control(c, 'issue', { case_id: 'P001/0', reviewer_id: 'T-SYNTHETIC' });
    const ad = a.r.result.packet_dir as string, bd = b.r.result.packet_dir as string;
    await fit(ad);
    await fit(bd);
    const ar = await control(c, 'release', { case_id: 'P001/0', reviewer_id: 'R-SYNTHETIC' }, '2026-10-28T06:00:00Z'), br = await control(c, 'release', { case_id: 'P001/0', reviewer_id: 'T-SYNTHETIC' }, '2026-10-28T06:00:00Z');
    await follow(ar.r.result.packet_dir as string);
    const incomplete = join(c.d, 'incomplete');
    expect((await call('export', c.privateDir, incomplete)).ok).toBe(false); // completed scores are not silently analyzed before explicit unblinding.
    await follow(br.r.result.packet_dir as string, true);
    expect((await control(c, 'unblind', { case_id: 'P001/0' }, '2026-10-28T08:00:00Z')).r.ok).toBe(true);
    expect((await control(c, 'issue', {case_id:'P001/0',reviewer_id:'T-SYNTHETIC'}, '2026-10-28T08:30:00Z')).r.error).toBe('CASE_ALREADY_UNBLINDED');
    const out = join(c.d, 'complete');
    expect((await call('export', c.privateDir, out)).ok).toBe(true);
    const r = JSON.parse(await readFile(join(out, 'results.json'), 'utf8'));
    expect(r.counts).toMatchObject({ raw: 4, teacherObservations: 2, paired: 1 });
    expect(r.metrics[0].participants).toBe(1);
    const borrowed = JSON.parse(await readFile(join(bd, 'packet.json'), 'utf8'));
    const attempt = join(ad, 'borrowed.command');
    await writeFile(attempt, JSON.stringify({ packet_id: borrowed.packet_id, request_id: randomUUID(), expected_revision: 0, at: '2026-10-28T07:00:00Z', operation: 'save', changes: {} }));
    expect((await call('apply', ad, attempt)).error).toBe('PACKET_MISMATCH');
    expect((await control(c, 'withdraw', { participant_id: 'P001', reviewer_id: 'R-SYNTHETIC' }, '2026-10-28T09:00:00Z')).r.ok).toBe(true);
    expect((await call(...a.args)).error).toBe('CONSENT_WITHDRAWN');
    // Corrupting the reviewer files after withdrawal must not cause new collection or retain old statistics.
    await writeFile(join(ar.r.result.packet_dir as string, 'packet.json'), 'bad');
    const revoked = join(c.d, 'withdrawn');
    expect((await call('export', c.privateDir, revoked)).ok).toBe(true);
    const latest = JSON.parse(await readFile(join(revoked, 'current.json'), 'utf8'));
    expect(latest.observations).toEqual([]);
    expect(JSON.parse(await readFile(join(revoked, 'results.json'), 'utf8')).counts).toMatchObject({ paired: 0, withdrawnParticipants: 1 });
    const freeze = join(c.d, 'freeze.json');
    await writeFile(freeze, JSON.stringify(c.s.freeze));
    const stale = spawnSync(process.execPath, [resolve('scripts/m34-replay.mjs'), freeze, join(revoked, 'current.json'), out, join(c.d, 'stale-rejected')], { encoding: 'utf8', env: process.env });
    expect(stale.status).toBe(3);
});
it('forms preserve missing fields, reject invalid scores/version tampering, recover retries and exclude unfinished/no-pair work', async () => {
    const c = await create(), a = await control(c, 'issue', { case_id: 'P001/0', reviewer_id: 'R-SYNTHETIC' }), dir = a.r.result.packet_dir as string;
    expect((await call(...a.args)).result.status).toBe('REPLAYED');
    const form = await call('form', dir, 'save');
    const publicForm: Record<string, unknown> = { operation: 'm34_review', ...form.result };
    const cmd = publicForm.command as {
        changes: Record<string, Record<string, unknown>>;
    };
    const item = Object.keys(cmd.changes)[0]!;
    cmd.changes[item] = { suitability: 8 };
    const path = join(dir, 'form.command');
    await writeFile(path, JSON.stringify(publicForm));
    expect((await call('apply', dir, path)).ok).toBe(false);
    cmd.changes[item] = { suitability: '适合' };
    await writeFile(path, JSON.stringify(publicForm));
    expect((await call('apply', dir, path)).ok).toBe(true);
    const out = join(c.d, 'draft-only');
    expect((await call('export', c.privateDir, out)).ok).toBe(true);
    expect(JSON.parse(await readFile(join(out, 'current.json'), 'utf8')).observations).toEqual([]);
    const p = await packet(dir);
    p.criteria_version = 'wrong';
    await writeFile(join(dir, 'packet.json'), JSON.stringify(p));
    expect((await call('view', dir)).ok).toBe(false);
    const setup = JSON.parse(await readFile(join(c.privateDir, 'setup.json'), 'utf8'));
    setup.freeze.rules.results = 'future';
    await writeFile(join(c.privateDir, 'setup.json'), JSON.stringify(setup));
    expect((await call('status', c.privateDir)).ok).toBe(false);
    const noPair = await create(false, s => { s.freeze.frozen.blocks[0]!.pair = null as never; });
    const i = await control(noPair, 'issue', { case_id: 'P001/0', reviewer_id: 'R-SYNTHETIC' });
    await fit(i.r.result.packet_dir as string);
    const release = await control(noPair, 'release', { case_id: 'P001/0', reviewer_id: 'R-SYNTHETIC' }, '2026-10-28T06:00:00Z');
    await follow(release.r.result.packet_dir as string);
    expect((await control(noPair, 'unblind', { case_id: 'P001/0' }, '2026-10-28T08:00:00Z')).r.ok).toBe(true);
    const np = join(noPair.d, 'output');
    expect((await call('export', noPair.privateDir, np)).ok).toBe(true);
    expect(JSON.parse(await readFile(join(np, 'current.json'), 'utf8')).observations).toEqual([]);
    expect(JSON.parse(await readFile(join(np, 'workflow.json'), 'utf8')).progress[0].status).toBe('NON_COMPARABLE_NO_DISTINCT_PAIR');
});

it('recovers a release interrupted after the fit seal without reopening scores or producing a second followup', async () => {
    const c = await create();
    const issued = await control(c, 'issue', {case_id:'P001/0', reviewer_id:'R-SYNTHETIC'});
    const dir = issued.r.result.packet_dir as string;
    await fit(dir);
    const p = await packet(dir);
    const journalDir = join(dir, 'journal');
    const events = await Promise.all((await readdir(journalDir)).sort().map(n => readFile(join(journalDir, n), 'utf8').then(JSON.parse)));
    const request_id = randomUUID(), at = '2026-10-28T06:00:00Z';
    const seal = reviewFlow.event(p, events, {packet_id:p.packet_id, request_id, expected_revision:events.length, at, operation:'release'}, true).event;
    // A committed fit seal with no coordinator receipt models a crash between the two append operations.
    await writeFile(join(journalDir, '00000003.json'), JSON.stringify(seal));
    const path = join(c.d, 'resume-release.json');
    await writeFile(path, JSON.stringify({request_id, expected_revision:c.revision, at, case_id:'P001/0', reviewer_id:'R-SYNTHETIC'}));
    const args = ['release', c.privateDir, path, c.publicRoot];
    const resumed = await call(...args);
    expect(resumed.ok).toBe(true);
    expect((await call(...args)).result).toMatchObject({status:'REPLAYED',packet_dir:resumed.result.packet_dir});
    expect((await call('view', dir)).result.released).toBe(true);
    expect(await readdir(journalDir)).toHaveLength(3);
    expect((await call('status', c.privateDir)).result.revision).toBe(2);
    expect((await packet(resumed.result.packet_dir as string)).fit_receipt_hash).not.toBeNull();
});
