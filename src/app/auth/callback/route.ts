import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/redirect";
import { requestOrigin } from "@/server/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const client = await createClient();
  const next = safeNext(url.searchParams.get("next"));
  let valid = false;
  try {
    if (client) {
      const code = url.searchParams.get("code");
      const tokenHash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type");
      if (code && code.length <= 2048)
        valid = !(await client.auth.exchangeCodeForSession(code)).error;
      else if (
        tokenHash &&
        tokenHash.length <= 2048 &&
        (type === "email" || type === "signup")
      )
        valid = !(await client.auth.verifyOtp({ token_hash: tokenHash, type }))
          .error;
      if (valid) {
        const verified = await client.auth.getUser();
        valid = !verified.error && Boolean(verified.data.user);
      }
    }
  } catch {
    valid = false;
  }
  const response = NextResponse.redirect(
    new URL(
      valid
        ? next
        : `/login?error=confirmation&next=${encodeURIComponent(next)}`,
      requestOrigin(request),
    ),
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
