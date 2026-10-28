import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/supabase/database.types';
import {cfSigningSecret} from '@/server/codeforces/repository';
import {signTutorPayload} from '@/server/tutor/repository';
import {ApiError,databaseError} from '@/server/http';
import {trackingSchema,trainingChoiceResultSchema,trainingFeedbackSchema} from '@/lib/validation/training-feedback';
import {learningRepository} from './repository';
import {z} from 'zod';
const absent=(code?:string)=>['PGRST202','42883'].includes(code??'');
export function trainingFeedbackRepository(client:SupabaseClient<Database>,userId:string){return {
  async record(payload:Record<string,unknown>){
    let secret:string;try{secret=cfSigningSecret();}catch(error){if(error instanceof ApiError && error.code==='CF_SYNC_NOT_CONFIGURED')return {available:false,items:[]};throw error;}
    const {data,error}=await client.rpc('record_recommendation_run',signTutorPayload({operation:'recommendation_record',...payload},userId,secret));
    if(absent(error?.code)||error?.code==='42501')return {available:false,items:[]};
    databaseError(error);return trackingSchema.parse(data);
  },
  async read(window:string,sessionId?:string){
    const {data,error}=await client.rpc('recommendation_training_evidence',{p_window:window,p_session_id:sessionId??null});
    if(absent(error?.code))return {available:false,items:[],total:0,asOf:new Date().toISOString()};
    databaseError(error);
    const stamp=z.object({revision:z.number().int().nonnegative(),officialRevision:z.number().int().nonnegative()}).parse(data);
    const result=trainingFeedbackSchema.parse(data);
    await learningRepository(client).assertRevision(stamp.revision,stamp.officialRevision);
    return result;
  },
  async choose(id:string,action:'start'|'skip'){
    const {data,error}=await client.rpc('recommendation_choice',{p_id:id,p_action:action});
    if(absent(error?.code))throw new ApiError(503,'TRACKING_UNAVAILABLE','推荐来源记录尚未就绪，请刷新或使用原训练入口。');
    databaseError(error);return trainingChoiceResultSchema.parse(data);
  },
};}
