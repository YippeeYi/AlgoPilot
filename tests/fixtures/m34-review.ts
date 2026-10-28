// Synthetic operators/materials only. No real reviewer, consent or training outcome.
import { replayFixture, replayTools } from './m34-replay';
import { verifyReplay } from '../../scripts/m34-replay-core';
import { createReviewWorkflow } from '../../scripts/m34-review-core';
import { observationSchema, resultsInputSchema, conditionsHash } from '../../scripts/m34-results';
export const reviewTools = { ...replayTools, verifyReplay, observationSchema, resultsInputSchema, conditionsHash, semanticDigest: (v: unknown) => conditionsHash(v) };
export const reviewFlow = createReviewWorkflow(reviewTools);
export function reviewSetup(teacher = false) {
    const { freeze } = replayFixture();
    freeze.frozen.reviewers[0]!.id = 'R-SYNTHETIC';
    if (teacher)
        freeze.frozen.reviewers.push({ id: 'T-SYNTHETIC', kind: 'teacher', participant_id: null, verified: true });
    const assignments = freeze.frozen.reviewers.map(r => ({ reviewer_id: r.id, case_id: 'P001/0' }));
    const materials = freeze.frozen.blocks.flatMap(b => (['A', 'B'] as const).flatMap(arm => b.prepared[arm === 'A' ? 'personalized' : 'baseline'].map(p => ({ case_id: b.prepared.participantId + '/' + b.prepared.block, arm, problem_key: p.contestId + '/' + p.index, statement: '[SYNTHETIC] 输入一个整数，输出其值。此文本仅用于演练。', reason: '[SYNTHETIC REASON SENTINEL] 本题难度位于共同范围，理由仅用于演练。', source: 'synthetic' as const, blindness_checked: true as const, no_solution_checked: true as const }))));
    return { version: 'm34-review-setup/1', freeze, assignments, materials };
}
export const fitValues = { suitability: '适合', difficulty: '适中', goal_match: true };
export const followValues = { reason_supported: true, previously_seen: false, missing_prerequisite: false, highest_hint_seen: 1, external_help: null, stopped: false, duration_minutes: null, outcome_self_report: 'solved_self_reported', protocol_deviation: null };
