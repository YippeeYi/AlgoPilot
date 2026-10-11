import { appendThoughtSchema } from "@/lib/validation/m1";
import { repository, routeId, pagination, pageResult } from "@/server/api";
import { handle, json, readJson } from "@/server/http";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handle(async () => {
    const repo = await repository();
    const id = await routeId(context);
    const { offset, limit } = pagination(request);
    return json(
      pageResult(await repo.thoughts(id, offset, limit), offset, limit),
    );
  });
}
export async function POST(request: Request, context: Context) {
  return handle(async () => {
    const repo = await repository();
    const id = await routeId(context);
    const input = await readJson(request, appendThoughtSchema);
    return json(await repo.append(id, input), 201);
  });
}
