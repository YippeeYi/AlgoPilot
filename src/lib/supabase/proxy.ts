import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { isPrivatePath, safeNext } from "@/lib/auth/redirect";

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // 公开预览不调用 Auth，也不读取私人数据。
  if (path === "/practice/preview") return NextResponse.next();
  if (
    path.startsWith("/practice/") &&
    !/^\/practice\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      path,
    )
  ) {
    return NextResponse.rewrite(new URL("/__missing-session__", request.url), {
      status: 404,
    });
  }
  const headers = new Headers(request.headers);
  headers.set("x-algopilot-path", path + request.nextUrl.search);
  let response = NextResponse.next({ request: { headers } });
  const config = getSupabaseConfig();
  if (!config) return response;
  const client = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        headers.set("cookie", request.headers.get("cookie") ?? "");
        response = NextResponse.next({ request: { headers } });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
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
  // getUser 访问 Auth 验证，并取得当前用户状态；不信任 getSession 内嵌 user。
  const { data, error } = await client.auth.getUser();
  if (isPrivatePath(path) && (error || !data.user)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", safeNext(path + request.nextUrl.search));
    const redirect = NextResponse.redirect(login);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    response = redirect;
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}
