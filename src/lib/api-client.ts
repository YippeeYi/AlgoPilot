export class ClientError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requestJson<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    cache: "no-store",
    credentials: "same-origin",
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
    );
  return value as T;
}
