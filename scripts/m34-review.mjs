// Local file workflow. Distribute only the opaque packet directory, never the coordinator directory.
import { open, mkdir, writeFile, readdir, link, unlink, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prepareStudy } from './m34-study.ts';
import { observationSchema, resultsInputSchema, inspectStudy, evaluateStudy, conditionsHash, renderStudyReport } from './m34-results.ts';
import { verifyReplay, semanticDigest, parseReplayJson, renderReplay } from './m34-replay-core.ts';
import { createReviewWorkflow, ReviewError } from './m34-review-core.ts';
const tools = { prepareStudy, observationSchema, resultsInputSchema, inspectStudy, conditionsHash, renderStudyReport, verifyReplay, semanticDigest }, flow = createReviewWorkflow(tools);
const fail = (yes, code) => { if (!yes)
    throw new ReviewError(code); };
const privateCommand = z.object({ request_id: z.uuid(), expected_revision: z.number().int().nonnegative(), at: z.iso.datetime(), reviewer_id: z.string().optional(), case_id: z.string().optional(), participant_id: z.string().optional() }).strict();
async function read(path) { const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try {
    const s = await f.stat();
    fail(s.isFile() && s.size <= 5000000, 'INVALID_FILE');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await f.readFile());
}
finally {
    await f.close();
} }
const json = async (path) => parseReplayJson(await read(path));
async function append(directory, event) { await mkdir(directory, { recursive: true, mode: 0o700 }); const target = join(directory, String(event.sequence).padStart(8, '0') + '.json'), pending = join(directory, randomUUID() + '.pending'); await writeFile(pending, JSON.stringify(event, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); try {
    await link(pending, target);
}
catch (e) {
    if (e.code === 'EEXIST')
        throw new ReviewError('REVISION_CONFLICT');
    throw e;
} await unlink(pending); }
async function entries(directory) { let names; try {
    names = await readdir(directory);
}
catch (e) {
    if (e.code === 'ENOENT')
        return [];
    throw e;
} fail(names.every(n => /^\d{8}\.json$/.test(n) || /^[a-f0-9-]+\.pending$/.test(n)), 'UNKNOWN_JOURNAL_FILE'); const committed = names.filter(n => n.endsWith('.json')).sort(); for (let i = 0; i < committed.length; i++)
    fail(committed[i] === String(i + 1).padStart(8, '0') + '.json', 'JOURNAL_GAP'); return Promise.all(committed.map(n => json(join(directory, n)))); }
async function packet(directory) { const p = flow.checkPacket(await json(join(directory, 'packet.json'))), events = await entries(join(directory, 'journal')); return { packet: p, events, state: flow.state(p, events) }; }
async function newDirectory(path) { await mkdir(path, { mode: 0o700 }); }
async function immutable(path, text) { try {
    await writeFile(path, text, { flag: 'wx', mode: 0o600 });
}
catch (e) {
    if (e.code !== 'EEXIST')
        throw e;
    fail(await read(path) === text, 'OUTPUT_CHANGED');
} }
async function publish(path, p) { try {
    await newDirectory(path);
}
catch (e) {
    if (e.code !== 'EEXIST')
        throw e;
} fail((await readdir(path)).every(n => ['packet.json', 'instructions.txt', 'journal'].includes(n)), 'OUTPUT_EXISTS'); await immutable(join(path, 'packet.json'), JSON.stringify(p, null, 2) + '\n'); await immutable(join(path, 'instructions.txt'), flow.render(p, flow.state(p, []))); }
async function coordinator(directory) {
    const setup = flow.validateSetup(await json(join(directory, 'setup.json')));
    const manifest = await json(join(directory, 'manifest.json'));
    fail(manifest.version === 'm34-review-private/1' && manifest.setup_hash === setup.setup_hash, 'COORDINATOR_CHANGED');
    const events = await entries(join(directory, 'journal')), state = { revision: 0, issues: [], releases: [], withdrawn: new Set(setup.input.blocks.filter(b => b.consent_status === 'withdrawn').map(b => b.prepared.participantId)), unblinded: {} };
    let previous = null;
    for (const e of events) {
        const { hash, ...body } = e;
        fail(e.version === 'm34-review-coordinator-event/1' && e.sequence === state.revision + 1 && e.previous_hash === previous && e.setup_hash === setup.setup_hash && semanticDigest(body) === hash, 'COORDINATOR_CHANGED');
        fold(state, e);
        state.revision++;
        previous = hash;
    }
    return { setup, events, state };
}
function fold(s, e) { if (e.operation === 'issue')
    s.issues.push(e.data);
else if (e.operation === 'release')
    s.releases.push(e.data);
else if (e.operation === 'withdraw')
    s.withdrawn.add(e.data.participant_id);
else if (e.operation === 'unblind')
    s.unblinded[e.data.case_id] = e.command.at;
else
    throw new ReviewError('UNKNOWN_COORDINATOR_EVENT'); }
async function commit(directory, c, operation, command, data, recovery = false) { const old = c.events.find(e => e.command.request_id === command.request_id); if (old) {
    fail(old.operation === operation && semanticDigest(old.command) === semanticDigest(command), 'REQUEST_CONFLICT');
    return old;
} fail(command.expected_revision === c.state.revision || recovery, 'REVISION_CONFLICT'); const body = { version: 'm34-review-coordinator-event/1', sequence: c.events.length + 1, previous_hash: c.events.at(-1)?.hash ?? null, setup_hash: c.setup.setup_hash, operation, command, data }; const e = { ...body, hash: semanticDigest(body) }; await append(join(directory, 'journal'), e); return e; }
const block = (c, id) => c.setup.input.blocks.find(b => b.prepared.participantId + '/' + b.prepared.block === id);
function active(c, case_id) { const b = block(c, case_id); fail(b, 'UNKNOWN_CASE'); fail(b.consent_status === 'active' && !c.state.withdrawn.has(b.prepared.participantId), 'CONSENT_WITHDRAWN'); return b; }
async function ensureSnapshot(c) { const next = await entries(join(c.directory, 'journal')); fail(next.at(-1)?.hash === c.events.at(-1)?.hash, 'COORDINATOR_REVISION_CHANGED'); }
async function exportStudy(directory, out) {
    const c = await coordinator(directory);
    c.directory = directory;
    const current = structuredClone(c.setup.input), progress = [], snapshots = [];
    for (const b of current.blocks) {
        const id = b.prepared.participantId + '/' + b.prepared.block;
        if (c.state.withdrawn.has(b.prepared.participantId))
            b.consent_status = 'withdrawn';
        b.unblinded_at = c.state.unblinded[id] ?? null;
    }
    for (const a of c.setup.setup.assignments) {
        const b = block(c, a.case_id);
        if (c.state.withdrawn.has(b.prepared.participantId)) {
            progress.push({ ref: semanticDigest(a), status: 'WITHDRAWN_NOT_COLLECTED' });
            continue;
        }
        const issued = c.state.issues.find(i => i.binding.case_id === a.case_id && i.binding.reviewer_id === a.reviewer_id), released = issued && c.state.releases.find(r => r.fit_packet_id === issued.binding.packet.packet_id);
        if (!issued || !released) {
            progress.push({ ref: semanticDigest(a), status: 'INCOMPLETE' });
            continue;
        }
        const fit = await packet(issued.fit_dir), follow = await packet(released.follow_dir);
        snapshots.push({ dir: issued.fit_dir, hash: fit.events.at(-1)?.hash }, { dir: released.follow_dir, hash: follow.events.at(-1)?.hash });
        fail(semanticDigest(fit.packet) === semanticDigest(issued.binding.packet) && semanticDigest(follow.packet) === semanticDigest(released.follow_packet), 'PACKET_BINDING_CHANGED');
        fail(fit.state.released && semanticDigest(fit.state.submissions.at(-1)) === released.fit_receipt_hash, 'FIT_CHANGED_AFTER_RELEASE');
        if (!follow.state.submissions.length) {
            progress.push({ ref: semanticDigest(a), status: 'INCOMPLETE' });
            continue;
        }
        fail(c.state.unblinded[a.case_id], 'ANALYSIS_NOT_UNBLINDED');
        current.observations.push(...flow.observations(c.setup, issued.binding, fit.state, follow.packet, follow.state));
        progress.push({ ref: semanticDigest(a), status: b.pair && b.pair.A !== b.pair.B ? 'SUBMITTED' : 'NON_COMPARABLE_NO_DISTINCT_PAIR' });
    }
    const result = evaluateStudy(current), markdown = renderStudyReport(result), replay = verifyReplay(c.setup.setup.freeze, current, result, markdown, tools);
    fail(replay.integrity === 'PASS', 'EXPORT_REPLAY_FAILED');
    for (const s of snapshots)
        fail((await entries(join(s.dir, 'journal'))).at(-1)?.hash === s.hash, 'REVIEW_REVISION_CHANGED');
    await ensureSnapshot(c);
    await newDirectory(out);
    for (const [file, content] of [['current.json', JSON.stringify(current, null, 2) + '\n'], ['results.json', JSON.stringify(result, null, 2) + '\n'], ['report.md', markdown], ['replay.json', JSON.stringify(replay, null, 2) + '\n'], ['replay.md', renderReplay(replay)], ['workflow.json', JSON.stringify({ version: 'm34-review-export/1', source: current.data_source, coordinator_revision: c.state.revision, progress, status: progress.some(x => x.status === 'INCOMPLETE') ? 'INCOMPLETE' : result.status, boundary: 'Only completed formal followup submissions enter observations. Drafts and withdrawn responses are not collected; this does not prove human consent or teaching benefit.' }, null, 2) + '\n']])
        await writeFile(join(out, file), content, { flag: 'wx', mode: 0o600 });
    return { status: result.status, progress };
}
export async function main(args) {
    const [op, ...p] = args;
    if (op === 'prepare') {
        fail(p.length === 2, 'ARGUMENTS');
        const s = flow.validateSetup(await json(p[0]));
        await newDirectory(p[1]);
        await writeFile(join(p[1], 'setup.json'), JSON.stringify(s.setup, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        await writeFile(join(p[1], 'manifest.json'), JSON.stringify({ version: 'm34-review-private/1', setup_hash: s.setup_hash }) + '\n', { flag: 'wx', mode: 0o600 });
        return { status: 'PREPARED' };
    }
    if (op === 'view') {
        fail(p.length === 1, 'ARGUMENTS');
        const r = await packet(p[0]);
        return { status: 'VIEW', text: flow.render(r.packet, r.state), revision: r.state.revision, submissions: r.state.submissions, draft: r.state.draft, has_unsubmitted_changes: semanticDigest(r.state.draft) !== semanticDigest(r.state.submissions.at(-1)?.values ?? {}), released: r.state.released };
    }
    if (op === 'form') {
        fail(p.length === 2 && ['save', 'submit', 'correct'].includes(p[1]), 'ARGUMENTS');
        const r = await packet(p[0]), command = { packet_id: r.packet.packet_id, request_id: randomUUID(), expected_revision: r.state.revision, at: new Date().toISOString(), operation: p[1] };
        if (p[1] !== 'submit')
            command.changes = Object.fromEntries(r.packet.lists.flatMap(l => l.items.map(i => [i.item_id, { ...r.state.draft[i.item_id] }])));
        if (p[1] !== 'save')
            command.confirm_complete = false;
        if (p[1] === 'correct')
            command.supersedes = r.state.submissions.at(-1)?.id;
        const required_fields = Object.fromEntries(r.packet.lists.flatMap(l => l.items.map(i => [i.item_id, r.packet.phase === 'fit' ? Object.keys(flow.fitFields) : r.packet.role === 'participant' && i.training ? Object.keys(flow.followFields) : ['reason_supported']])));
        return { status: 'FORM', command, required_fields, notice: '只填写已知字段；NULL须明确表示无法判断。保存不是提交；正式提交须confirm_complete=true。' };
    }
    if (op === 'apply') {
        fail(p.length === 2, 'ARGUMENTS');
        const r = await packet(p[0]), raw = await json(p[1]), command = raw.operation === 'm34_review' && raw.status === 'FORM' && Object.keys(raw).every(k => ['operation', 'status', 'command', 'required_fields', 'notice'].includes(k)) ? raw.command : raw, next = flow.event(r.packet, r.events, command);
        if (!next.replayed)
            await append(join(p[0], 'journal'), next.event);
        return { status: next.event.command.operation === 'save' ? 'DRAFT_SAVED' : next.event.command.operation === 'correct' ? 'CORRECTED' : 'SUBMITTED', replayed: next.replayed, revision: next.event.sequence, receipt: next.event.command.operation === 'save' ? null : next.event.command.request_id };
    }
    if (op === 'export') {
        fail(p.length === 2, 'ARGUMENTS');
        return exportStudy(p[0], p[1]);
    }
    if (op === 'status') {
        fail(p.length === 1, 'ARGUMENTS');
        const c = await coordinator(p[0]);
        return { status: 'COORDINATOR', revision: c.state.revision, packets: c.state.issues.map(i => ({ case_id: i.binding.case_id, reviewer_id: i.binding.reviewer_id, fit_dir: i.fit_dir, follow_dir: c.state.releases.find(r => r.fit_packet_id === i.binding.packet.packet_id)?.follow_dir ?? null })), assignments: c.setup.setup.assignments.map(a => ({ case_id: a.case_id, reviewer_id: a.reviewer_id, withdrawn: c.state.withdrawn.has(block(c, a.case_id).prepared.participantId) })) };
    }
    fail(['issue', 'release', 'withdraw', 'unblind'].includes(op) && p.length === (['issue', 'release'].includes(op) ? 3 : 2), 'ARGUMENTS');
    const directory = p[0], c = await coordinator(directory), command = privateCommand.parse(await json(p[1]));
    const old = c.events.find(e => e.command.request_id === command.request_id);
    if (old) {
        fail(old.operation === op && semanticDigest(old.command) === semanticDigest(command), 'REQUEST_CONFLICT');
        if (op === 'issue') {
            active(c, command.case_id);
            fail(resolve(p[2]) === old.data.public_root, 'REQUEST_CONFLICT');
            await publish(old.data.fit_dir, old.data.binding.packet);
        }
        if (op === 'release') {
            active(c, command.case_id);
            const i = c.state.issues.find(i => i.binding.packet.packet_id === old.data.fit_packet_id);
            const f = await packet(i.fit_dir);
            fail(f.state.released && semanticDigest(f.state.submissions.at(-1)) === old.data.fit_receipt_hash, 'FIT_CHANGED_AFTER_RELEASE');
            fail(resolve(p[2]) === old.data.public_root, 'REQUEST_CONFLICT');
            await publish(old.data.follow_dir, old.data.follow_packet);
        }
        return { status: 'REPLAYED', revision: old.sequence, packet_dir: old.data.fit_dir ?? old.data.follow_dir };
    }
    if (op !== 'release')
        fail(command.expected_revision === c.state.revision, 'REVISION_CONFLICT');
    if (op === 'issue') {
        const b = active(c, command.case_id);
        fail(!c.state.unblinded[command.case_id], 'CASE_ALREADY_UNBLINDED');
        fail(Date.parse(command.at) >= Date.parse(b.frozen_at), 'BEFORE_FREEZE');
        fail(!c.state.issues.some(i => i.binding.case_id === command.case_id && i.binding.reviewer_id === command.reviewer_id), 'ASSIGNMENT_ALREADY_ISSUED');
        if (b.prepared.block === 1) {
            const prior = b.prepared.participantId + '/0';
            if (block(c, prior)) {
                const first = c.state.issues.filter(i => i.binding.case_id === prior && i.binding.packet.role === 'participant');
                fail(first.length, 'PREVIOUS_BLOCK_INCOMPLETE');
                for (const i of first) {
                    const release = c.state.releases.find(r => r.fit_packet_id === i.binding.packet.packet_id);
                    fail(release, 'PREVIOUS_BLOCK_INCOMPLETE');
                    const state = (await packet(release.follow_dir)).state;
                    fail(state.submissions.length && Date.parse(b.frozen_at) >= Date.parse(state.submissions.at(-1).at), 'PREVIOUS_BLOCK_INCOMPLETE');
                }
            }
        }
        const binding = flow.issue(c.setup, command.reviewer_id, command.case_id, randomUUID(), command.at), public_root = resolve(p[2]);
        fail(!public_root.startsWith(resolve(directory) + '/') && !resolve(directory).startsWith(public_root + '/') && public_root !== resolve(directory), 'SEPARATE_PUBLIC_ROOT_REQUIRED');
        await mkdir(public_root, { recursive: true, mode: 0o700 });
        const fit_dir = join(public_root, binding.packet.packet_id);
        try {
            await stat(fit_dir);
            throw new ReviewError('OUTPUT_EXISTS');
        }
        catch (e) {
            if (e.code !== 'ENOENT')
                throw e;
        }
        const e = await commit(directory, c, op, command, { binding, public_root, fit_dir });
        await publish(fit_dir, binding.packet);
        return { status: 'ISSUED', revision: e.sequence, packet_dir: fit_dir };
    }
    if (op === 'release') {
        active(c, command.case_id);
        const i = c.state.issues.find(i => i.binding.case_id === command.case_id && i.binding.reviewer_id === command.reviewer_id);
        fail(i, 'UNKNOWN_ASSIGNMENT');
        fail(!c.state.releases.some(r => r.fit_packet_id === i.binding.packet.packet_id), 'ALREADY_RELEASED');
        const fit = await packet(i.fit_dir);
        fail(semanticDigest(fit.packet) === semanticDigest(i.binding.packet), 'PACKET_CHANGED');
        const receipt = fit.state.submissions.at(-1);
        fail(receipt, 'FIT_NOT_SUBMITTED');
        fail(Date.parse(command.at) >= Date.parse(receipt.at), 'RELEASE_BEFORE_FIT');
        const previousRelease = fit.events.find(e => e.command.request_id === command.request_id);
        fail(command.expected_revision === c.state.revision || previousRelease, 'REVISION_CONFLICT');
        const follow_packet = flow.followup(c.setup, i.binding, fit.state, command.at), public_root = resolve(p[2]);
        fail(!public_root.startsWith(resolve(directory) + '/') && !resolve(directory).startsWith(public_root + '/') && public_root !== resolve(directory), 'SEPARATE_PUBLIC_ROOT_REQUIRED');
        await mkdir(public_root, { recursive: true, mode: 0o700 });
        const follow_dir = join(public_root, follow_packet.packet_id), releaseCommand = previousRelease?.command ?? { packet_id: fit.packet.packet_id, request_id: command.request_id, expected_revision: fit.state.revision, at: command.at, operation: 'release' };
        const event = flow.event(fit.packet, fit.events, releaseCommand, true);
        if (!event.replayed)
            await append(join(i.fit_dir, 'journal'), event.event);
        const e = await commit(directory, c, op, command, { recovered: Boolean(previousRelease), fit_packet_id: fit.packet.packet_id, fit_receipt_hash: semanticDigest(receipt), follow_packet, public_root, follow_dir }, Boolean(previousRelease));
        await publish(follow_dir, follow_packet);
        return { status: 'RELEASED', revision: e.sequence, packet_dir: follow_dir };
    }
    if (op === 'withdraw') {
        const owner = c.setup.input.reviewers.find(r => r.id === command.reviewer_id && r.kind === 'participant' && r.participant_id === command.participant_id);
        fail(owner && c.setup.input.blocks.some(b => b.prepared.participantId === command.participant_id), 'WITHDRAWAL_REQUIRES_OWNER');
        fail(!c.state.withdrawn.has(command.participant_id), 'ALREADY_WITHDRAWN');
        const e = await commit(directory, c, op, command, { participant_id: command.participant_id });
        return { status: 'WITHDRAWN', revision: e.sequence };
    }
    const b = active(c, command.case_id);
    fail(!c.state.unblinded[command.case_id], 'ALREADY_UNBLINDED');
    const issued = c.state.issues.filter(i => i.binding.case_id === command.case_id);
    fail(issued.length, 'NO_COMPLETED_REVIEW');
    for (const i of issued) {
        const release = c.state.releases.find(r => r.fit_packet_id === i.binding.packet.packet_id);
        fail(release, 'INCOMPLETE_REVIEW');
        const f = await packet(release.follow_dir);
        fail(f.state.submissions.length && Date.parse(command.at) >= Date.parse(f.state.submissions.at(-1).at), 'INCOMPLETE_REVIEW');
    }
    fail(Date.parse(command.at) >= Date.parse(b.frozen_at), 'BEFORE_FREEZE');
    const e = await commit(directory, c, op, command, { case_id: command.case_id });
    return { status: 'UNBLINDED_FOR_PRIVATE_ANALYSIS', revision: e.sequence };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const r = await main(process.argv.slice(2));
        console.log(JSON.stringify({ operation: 'm34_review', ...r }));
        process.exitCode = r.status === 'INVALID' ? 3 : r.status === 'INCOMPLETE' || r.status === 'NON_COMPARABLE' ? 2 : 0;
    }
    catch (e) {
        console.error(JSON.stringify({ operation: 'm34_review', error: e instanceof ReviewError ? e.code : e instanceof z.ZodError ? 'INVALID_FIELDS' : 'INPUT_OR_OUTPUT_ERROR', fields: e instanceof ReviewError ? e.fields : [] }));
        process.exitCode = e instanceof ReviewError || e instanceof z.ZodError ? 3 : 4;
    }
}
