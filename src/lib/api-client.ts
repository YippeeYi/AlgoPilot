import { reviewRejectionReasonSchema, type ReviewRejectionReason } from "@/lib/validation/review";

export class ClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public reason?: ReviewRejectionReason,
  ) {
    super(message);
  }
}

export async function requestJson<T>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    cache: "no-store",
    credentials: "same-origin",
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    headers:
      options.body === undefined
        ? undefined
        : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const value = await response.json();
  if (!response.ok)
    throw new ClientError(
      response.status,
      value.error?.message || "请求未完成，请重试。",
      typeof value.error?.code === "string" ? value.error.code : undefined,
      reviewRejectionReasonSchema.safeParse(value.error?.reason).success ? value.error.reason : undefined,
    );
  return value as T;
}
