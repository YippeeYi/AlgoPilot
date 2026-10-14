import { requireContext } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";
import { cfSyncInputSchema } from "@/lib/validation/cf-account";
import { cfAccountRepository } from "@/server/codeforces/account-repository";
import { synchronizeCfAccount } from "@/server/codeforces/account-service";
export const maxDuration = 120;
export function POST(request: Request) { return handle(async () => { const { client, user } = await requireContext(); const input = await readJson(request, cfSyncInputSchema); return json(await synchronizeCfAccount(cfAccountRepository(client, user.id), input)); }); }
