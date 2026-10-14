import { requireContext } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";
import { cfAccountInputSchema } from "@/lib/validation/cf-account";
import { cfAccountRepository } from "@/server/codeforces/account-repository";
import { mutateCfAccount } from "@/server/codeforces/account-service";
export const maxDuration = 120;
export function GET() { return handle(async () => { const { client, user } = await requireContext(); return json({ state: await cfAccountRepository(client, user.id).state() }); }); }
export function POST(request: Request) { return handle(async () => { const { client, user } = await requireContext(); const input = await readJson(request, cfAccountInputSchema); return json(await mutateCfAccount(cfAccountRepository(client, user.id), input)); }); }
