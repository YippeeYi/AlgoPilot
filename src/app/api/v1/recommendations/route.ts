import { requireContext } from "@/server/auth";
import { learningRepository } from "@/server/learning/repository";
import { cfRepository } from "@/server/codeforces/repository";
import { catalog } from "@/server/codeforces/catalog";
import { catalogQuerySchema } from "@/lib/validation/m3";
import { recommendationQuerySchema } from "@/lib/validation/learning";
import { recommend, recommendationTarget } from "@/features/learning/engine";
import { skillIntelligence } from "@/features/learning/intelligence";
import { ApiError, handle, json, readJson } from "@/server/http";
import {trainingFeedbackRepository} from '@/server/learning/training-feedback';
export function POST(request: Request) {
    return handle(async () => {
        const { client, user } = await requireContext();
        const input = await readJson(request, recommendationQuerySchema);
        const repo = learningRepository(client);
        const evidence = await repo.evidence();
        const diagnostic = input.focus ? skillIntelligence(evidence,input.focus.window,Date.now()).topics.find(t=>t.topic===input.focus!.topic && t.action) : null;
        if(input.focus && !diagnostic) throw new ApiError(409,"SKILL_ACTION_STALE","当前证据不再支持这条专项建议，请刷新能力画像；也可手动选择训练主题。");
        const effective = diagnostic ? {...evidence,preferences:{...recommendationTarget(evidence).preferences,themes:[diagnostic.topic]}} : evidence;
        const { preferences, target } = recommendationTarget(effective);
        const cache = await catalog(cfRepository(client, user.id), catalogQuerySchema.parse({ limit: 1 }));
        const candidates = await repo.candidates(preferences, target);
        const recommendations = recommend(effective, candidates.items, input.exclude);
        if(diagnostic) for(const item of recommendations.items) {
            item.reasons.push(`来自能力画像的显式专项：${diagnostic.topic}，${input.focus!.window === "all" ? "已加载全部" : `最近 ${input.focus!.window} 天创建的`}训练中 ${diagnostic.knownOutcomes} 道题有明确结果，其中 ${diagnostic.concernSamples} 道存在 L3+ 或未解/放弃记录（并集）。这是待验证的训练信号，不是能力缺陷结论。`);
            item.refs = [...new Map([...item.refs,...diagnostic.refs].map(r=>[r.id,r])).values()];
        }
        if (evidence.official) await repo.assertRevision(evidence.revision, evidence.official.revision);
        else await repo.assertRevision(evidence.revision);
        const tracking=input.trackingId && recommendations.items.length ? await trainingFeedbackRepository(client,user.id).record({runId:input.trackingId,revision:evidence.revision,officialRevision:evidence.official?.revision??0,
            focus:input.focus??null,baseline:diagnostic ? {samples:diagnostic.knownOutcomes,concerns:diagnostic.concernSamples,solved:diagnostic.selfReportedSolved}:null,
            repeat:preferences.repeat,problemIds:recommendations.items.map(i=>i.problem.id)}) : {available:false,items:[]};
        // A persisted snapshot must not release stale official/review evidence after a concurrent revoke.
        if(input.trackingId){if(evidence.official)await repo.assertRevision(evidence.revision,evidence.official.revision);else await repo.assertRevision(evidence.revision);}
        return json({ ...recommendations,tracking, preferences: recommendationTarget(evidence).preferences, focus: diagnostic ? {topic:diagnostic.topic,window:input.focus!.window} : null, candidateCount: candidates.total, syncedAt: cache.syncedAt, stale: cache.stale, notice: cache.notice });
    });
}
