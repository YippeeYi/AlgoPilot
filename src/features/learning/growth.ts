import { learningTopics, type LearningEvidence, type SkillWindow } from '@/lib/validation/learning';
type Rows = LearningEvidence['sessions'];
const explicit = (r: Rows[number]) => ['solved_self_reported', 'unsolved', 'abandoned'].includes(r.outcome ?? '');
const solved = (r: Rows[number]) => r.outcome === 'solved_self_reported';
const concern = (r: Rows[number]) => r.maxHint >= 3 || r.outcome === 'unsolved' || r.outcome === 'abandoned';
const refs = (rows: Rows) => rows.map(r => ({ kind: 'training' as const, id: r.id }));
function describe(rows: Rows, minimum: number) {
  const known = rows.filter(explicit), rated = rows.filter(r => solved(r) && r.rating !== null).map(r => r.rating!).sort((a,b) => a-b);
  const middle = Math.floor(rated.length / 2);
  return { problems: rows.length, known: known.length, solved: rows.filter(solved).length, rated: rated.length,
    median: rated.length >= minimum ? rated.length % 2 ? rated[middle]! : (rated[middle-1]! + rated[middle]!) / 2 : null,
    completion: known.length >= minimum ? { numerator: known.filter(solved).length, denominator: known.length } : null,
    tagged: rows.filter(r => r.tags.length).length,
    topics: learningTopics.filter(t => rows.some(r => r.tags.includes(t))).length, refs: refs(rows) };
}
/** Cohorts of latest completed problems supplied by intelligence, NOT historical skill snapshots.
 * Official OK is deliberately absent: incomplete submission coverage is not a training denominator. */
export function growthObservations(current: Rows, previous: Rows | null, options: {
  window: SkillWindow; now: number; incomplete: boolean; minimum: number; concernMinimum: number; concernRatio: number;
}) {
  const { window, now, incomplete, minimum } = options;
  const days = window === 'all' ? null : Number(window) * 86400000;
  const recent = describe(current, minimum), prior = previous && describe(previous, minimum);
  const comparable = previous !== null && !incomplete;
  const topics = learningTopics.map(topic => {
    const rows = current.filter(r => r.tags.includes(topic)), old = previous?.filter(r => r.tags.includes(topic)) ?? [];
    const a = describe(rows, minimum), b = previous ? describe(old, minimum) : null;
    const transition = !comparable ? 'unknown' as const : a.known >= minimum && b!.known < minimum ? 'more_evidence' as const
      : a.known < minimum && b!.known >= minimum ? 'less_evidence' as const : 'unchanged' as const;
    // Same thresholds as diagnostics; a practice signal stays with the existing action.
    const concerns = rows.filter(explicit).filter(concern).length;
    const practiceSignal = a.known >= minimum && concerns >= options.concernMinimum && concerns / a.known >= options.concernRatio;
    const reason = comparable && !practiceSignal && a.known >= minimum
      ? transition === 'more_evidence' ? 'new_evidence' as const
        : a.median !== null && b!.median !== null && a.median === b!.median && a.solved / a.known >= 0.8 ? 'same_range' as const : null
      : null;
    return { topic, current: a, previous: b, transition, action: reason ? { topic, window, reason,
      explanation: reason === 'new_evidence'
        ? `已加载前窗 ${b!.known}、本窗 ${a.known} 道明确结果；本窗已达到${minimum}题的描述门槛，可再选同方向题检验记录表现。`
        : `前窗 ${b!.rated}、本窗 ${a.rated} 道有 Rating 的自报解出题，中位数同为 ${a.median}；可检查是否继续当前难度，想挑战时请主动调整目标。`,
      refs: [...a.refs, ...b!.refs] } : null };
  }).filter(t => t.current.problems || t.previous?.problems);
  const bands = [...new Set([...current, ...(previous ?? [])].filter(r => r.rating !== null).map(r => Math.floor(r.rating! / 400) * 400))]
    .sort((a,b) => a-b).map(min => ({ min, max: min+399,
      current: describe(current.filter(r => r.rating !== null && r.rating >= min && r.rating < min+400), minimum),
      previous: previous ? describe(previous.filter(r => r.rating !== null && r.rating >= min && r.rating < min+400), minimum) : null }));
  return { version: 'growth-observations/1', current: recent, previous: prior, topics, bands,
    currentStart: days === null ? null : new Date(now-days).toISOString(), currentEnd: new Date(now).toISOString(),
    previousStart: days === null ? null : new Date(now-2*days).toISOString(), previousEnd: days === null ? null : new Date(now-days).toISOString(),
    comparison: !prior ? 'not_applicable' as const : incomplete ? 'incomplete' as const
      : recent.known < minimum || prior.known < minimum ? 'insufficient' as const : 'descriptive' as const,
    medianChange: comparable && recent.median !== null && prior?.median != null ? recent.median-prior.median : null,
    actions: topics.flatMap(t => t.action ? [t.action] : []).slice(0,3) };
}
export type GrowthObservations = ReturnType<typeof growthObservations>;
