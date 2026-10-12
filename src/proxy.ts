import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/problems/:path*",
    "/plans/:path*",
    "/sessions/:path*",
    "/reviews/:path*",
    "/analytics/:path*",
    "/settings/:path*",
    "/practice/:path*",
    "/api/v1/:path*",
  ],
};
