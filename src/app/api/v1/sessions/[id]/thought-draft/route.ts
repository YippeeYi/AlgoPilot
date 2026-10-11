import { saveDraftSchema } from "@/lib/validation/m1";
import { repository, routeId } from "@/server/api";
import { handle, json, readJson } from "@/server/http";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const repo = await repository();
    const id = await routeId(context);
    const input = await readJson(request, saveDraftSchema);
    return json({ session: await repo.draft(id, "thought", input) });
  });
}
