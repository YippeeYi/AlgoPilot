import { z } from "zod";

const urlSchema = z.url().refine(
  (value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  },
  { when: (payload) => z.url().safeParse(payload.value).success },
);

export function getSupabaseConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!urlSchema.safeParse(url).success || !key) return null;
  return { url: url!, key };
}
