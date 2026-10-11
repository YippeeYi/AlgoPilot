import "server-only";
import { requireContext } from "@/server/auth";
import { trainingRepository } from "@/server/db/training";
import { idSchema, listSchema } from "@/lib/validation/m1";

export async function repository() {
  const { client, user } = await requireContext();
  return trainingRepository(client, user.id);
}
export async function routeId(context: { params: Promise<{ id: string }> }) {
  return idSchema.parse((await context.params).id);
}
export function pagination(request: Request) {
  return listSchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
}
export function pageResult<T>(items: T[], offset: number, limit: number) {
  return { items, nextOffset: items.length === limit ? offset + limit : null };
}
