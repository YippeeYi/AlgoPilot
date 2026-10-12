import { z } from "zod";
import { requireContext } from "@/server/auth";
import { routeId } from "@/server/api";
import { appendThoughtSchema, sessionSchema, thoughtSchema } from "@/lib/validation/m1";
import { handle, json, readJson, databaseError } from "@/server/http";
export function POST(request: Request, c: {
    params: Promise<{
        id: string;
    }>;
}) { return handle(async () => { const { client } = await requireContext(); const input = await readJson(request, appendThoughtSchema.refine(v => v.content.length <= 63000)); const { data, error } = await client.rpc("supplement_cf_context", { p_id: await routeId(c), p_content: input.content, p_revision: input.expectedRevision, p_request_id: input.requestId }); databaseError(error); return json(z.object({ session: sessionSchema, thought: thoughtSchema }).parse(data)); }); }
