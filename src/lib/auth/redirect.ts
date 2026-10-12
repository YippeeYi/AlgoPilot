export function safeNext(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    [...value].some((char) => char.charCodeAt(0) < 32)
  )
    return "/dashboard";
  const url = new URL(value, "https://algopilot.invalid");
  if (
    url.origin !== "https://algopilot.invalid" ||
    !isPrivatePath(url.pathname)
  )
    return "/dashboard";
  return url.pathname + url.search;
}

export function isPrivatePath(path: string) {
  if (path === "/practice/preview") return false;
  return [
    "/dashboard",
    "/problems",
    "/plans",
    "/sessions",
    "/reviews",
    "/analytics",
    "/settings",
    "/practice",
  ].some((base) => path === base || path.startsWith(base + "/"));
}
