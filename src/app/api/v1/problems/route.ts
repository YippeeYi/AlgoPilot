import { createProblemSchema } from "@/lib/validation/m1";
import { repository, pagination, pageResult } from "@/server/api";
import { handle, json, readJson } from "@/server/http";

export async function GET(request: Request) {
  return handle(async () => {
    const repo = await repository();
    const { offset, limit } = pagination(request);
    return json(pageResult(await repo.problems(offset, limit), offset, limit));
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const repo = await repository();
    const input = await readJson(request, createProblemSchema);
    return json({ problem: await repo.createProblem(input) }, 201);
  });
}
