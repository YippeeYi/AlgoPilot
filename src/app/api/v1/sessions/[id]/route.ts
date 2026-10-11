import { transitionSchema } from "@/lib/validation/m1";
import { repository, routeId } from "@/server/api";
import { handle, json, readJson } from "@/server/http";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return handle(async () => {
    const repo = await repository();
    const session = await repo.get(await routeId(context));
    return json({
      session,
      problem: session.problem_id
        ? await repo.problem(session.problem_id)
        : null,
      serverNow: new Date().toISOString(),
    });
  });
}
export async function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const repo = await repository();
    const id = await routeId(context);
    const input = await readJson(request, transitionSchema);
    return json({
      session: await repo.transition(id, input),
      serverNow: new Date().toISOString(),
    });
  });
}
