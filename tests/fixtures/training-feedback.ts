import type {TrainingFeedbackItem} from '@/lib/validation/training-feedback';
import {skillId} from './skill-intelligence';
export const trial=(n=1,changes:Partial<TrainingFeedbackItem>={}):TrainingFeedbackItem=>({id:skillId(n),runId:skillId(100),problemId:skillId(10000+n),contestId:10000+n,index:'A',issuedAt:'2026-10-28T00:00:00Z',focus:null,baseline:null,skippedAt:null,chosenAt:null,sessionId:null,originated:false,sessionStatus:null,outcome:null,endedAt:null,official:'disabled',officialSyncedAt:null,...changes});
