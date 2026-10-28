import {requireContext} from '@/server/auth';
import {trainingFeedbackRepository} from '@/server/learning/training-feedback';
import {feedbackQuerySchema,trainingChoiceSchema} from '@/lib/validation/training-feedback';
import {handle,json,readJson} from '@/server/http';
export function GET(request:Request){return handle(async()=>{const {client,user}=await requireContext();const q=feedbackQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));return json(await trainingFeedbackRepository(client,user.id).read(q.window,q.sessionId));});}
export function POST(request:Request){return handle(async()=>{const {client,user}=await requireContext();const p=await readJson(request,trainingChoiceSchema);return json(await trainingFeedbackRepository(client,user.id).choose(p.id,p.action));});}
