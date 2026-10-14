import { defaultPreferences, type LearningEvidence, type LearningCandidate } from "@/lib/validation/learning";
// Synthetic player histories, never actual players or official ability ratings.
export const fixtureId = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function emptyEvidence(): LearningEvidence { return { preferences: null, revision: 0, totalSessions: 0, sessions: [], reviews: [], feedback: [] }; }
export function training(n: number, rating: number, topic = "graphs", hint = 0): LearningEvidence["sessions"][number] {
  return { id: fixtureId(100000 + n), problemId: fixtureId(200000 + n), status: "completed", outcome: "solved_self_reported", rating, tags: [topic], maxHint: hint, externalEditorial: null, thoughtCount: 1, createdAt: new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString() };
}
export function syntheticCatalog(count = 2400): LearningCandidate[] {
  const topics = ["graphs", "dp", "math", "greedy", "strings", "trees", "implementation", "binary search"];
  return Array.from({length:count}, (_, i) => ({ id: fixtureId(i + 1), contestId: 10000 + i, index: "A", name: "[SYNTHETIC] Structural evaluation only", rating: 800 + Math.floor(i / topics.length) % 19 * 100, tags: [topics[i % topics.length]!], solvedCount: null, inPlan: false, practiced: false }));
}
export function scenarios(pool: LearningCandidate[]) {
  const make = (min:number,max:number,history:number,topic="math",hint=0) => {
    const e=emptyEvidence(); e.preferences={...defaultPreferences,min,max};
    e.sessions=Array.from({length:history},(_,i)=>training(i+1,min+Math.floor((max-min)/200)*100,topic,hint));e.totalSessions=history;return e;
  };
  const cold=emptyEvidence(), sparse=make(1000,1600,2), beginner=make(800,1200,16), intermediate=make(1400,1800,30), advanced=make(2000,2600,40), graph=make(1400,1800,9,"graphs",4), dp=make(1400,1800,9,"dp",4);
  graph.preferences!.goal="independence";dp.preferences!.goal="independence";
  const extensive=make(1400,1800,100);
  const solved=pool.filter(p=>p.rating!==null&&p.rating>=1400&&p.rating<=1800).slice(0,40);
  extensive.sessions.push(...solved.map((c,i)=>({...training(300+i,c.rating!,c.tags[0]??"math"),problemId:c.id,tags:c.tags})));extensive.totalSessions=extensive.sessions.length;
  extensive.feedback=pool.filter(p=>p.rating!==null&&p.rating>=1400&&p.rating<=1800).slice(-4).map((p,i)=>({id:fixtureId(500000+i),problemId:p.id,kind:i%2?"too_easy":"too_hard",rating:p.rating,createdAt:new Date(Date.UTC(2026,9,1)+i*60000).toISOString()}));
  return [{id:"cold",label:"无历史冷启动",e:cold},{id:"sparse",label:"两题少量记录",e:sparse},{id:"beginner",label:"800–1200 初学者",e:beginner},{id:"intermediate",label:"1400–1800 中等选手",e:intermediate},{id:"advanced",label:"2000+ 进阶选手",e:advanced},{id:"graphs",label:"图论高提示依赖",e:graph},{id:"dp",label:"DP 高提示依赖",e:dp},{id:"extensive",label:"大量完成/多计划/多反馈",e:extensive}];
}
