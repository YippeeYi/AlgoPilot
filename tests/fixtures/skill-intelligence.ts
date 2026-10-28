import { defaultPreferences, type LearningEvidence } from "@/lib/validation/learning";
export const skillNow = Date.parse("2026-10-28T00:00:00Z");
export const skillId = (n: number) => `73000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const skillSession = (n: number, overrides: Partial<LearningEvidence["sessions"][number]> = {}): LearningEvidence["sessions"][number] => ({
  id: skillId(n), problemId: skillId(n+10000), status: "completed", outcome: "solved_self_reported", rating: 1400, tags: ["graphs"], maxHint: 4,
  externalEditorial: null, thoughtCount: 0, createdAt: new Date(skillNow - 86400000).toISOString(), ...overrides,
});
export const skillEvidence = (count = 0): LearningEvidence => ({ preferences: {...defaultPreferences,min:1200,max:1800}, revision: 0, totalSessions: count,
  sessions: Array.from({length:count},(_,n)=>skillSession(n+1)), reviews: [], feedback: [] });
