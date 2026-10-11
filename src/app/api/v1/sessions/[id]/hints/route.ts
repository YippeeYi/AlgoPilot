import { requireContext } from "@/server/auth";
import { routeId } from "@/server/api";
import { handle, json, readJson } from "@/server/http";
import { hintRequestSchema } from "@/lib/validation/m2";
import { tutorRepository } from "@/server/tutor/repository";
export const runtime = "nodejs";
export function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { client, user } = await requireContext();
    const id = await routeId(context);
    const input = await readJson(request, hintRequestSchema);
    const repo = tutorRepository(client, user.id);
    return json(await repo.hint(id, input));
  });
}
