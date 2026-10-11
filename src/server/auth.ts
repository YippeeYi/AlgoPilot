import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { ApiError } from "@/server/http";

export async function verifiedContext() {
  const client = await createClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new ApiError(401, "UNAUTHENTICATED", "登录已失效，请重新登录。");
  return { client, user: data.user };
}

export const pageContext = cache(verifiedContext);
export async function requireContext() {
  const context = await verifiedContext();
  if (!context)
    throw new ApiError(
      503,
      "SUPABASE_NOT_CONFIGURED",
      "Supabase 未配置或配置不完整。",
    );
  return context;
}
