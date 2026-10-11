import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";

export async function createClient() {
  const config = getSupabaseConfig();
  if (!config) return null;
  const jar = await cookies();
  return createServerClient<Database>(config.url, config.key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        // Server Components 不能写 Cookie；proxy 已刷新。Route Handlers 中正常写入。
        try {
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* read-only render */
        }
      },
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          cache: "no-store",
          signal: init?.signal ?? AbortSignal.timeout(15_000),
        }),
    },
  });
}
