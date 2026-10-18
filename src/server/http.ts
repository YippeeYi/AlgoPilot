import "server-only";
import { z } from "zod";
import { reviewRejectionReasonSchema, type ReviewRejectionReason } from "@/lib/validation/review";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public reason?: ReviewRejectionReason,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function handle(operation: () => Promise<Response>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError)
      return json(
        { error: { code: error.code, message: error.message,
          ...(error.code === "REVIEW_OUTPUT_REJECTED" && reviewRejectionReasonSchema.safeParse(error.reason).success ? { reason: error.reason } : {}) } },
        error.status,
      );
    if (error instanceof z.ZodError)
      return json(
        {
          error: {
            code: "INVALID_INPUT",
            message: "请求字段或格式不符合要求。",
          },
        },
        422,
      );
    // 不记录请求内容、Cookie、SDK 错误原文或环境变量。
    return json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "服务暂时无法完成请求，请稍后重试。",
        },
      },
      503,
    );
  }
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== requestOrigin(request)) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ApiError(403, "INVALID_ORIGIN", "请求来源不受支持。");
}

// Next 的内部 Request URL 可能使用 localhost；不信任 X-Forwarded-Host。
// 生产部署明确设置 APP_URL；本地以浏览器不可伪造的请求 Host 还原同源地址。
export function requestOrigin(request: Request) {
  if (process.env.APP_URL) {
    const configured = new URL(process.env.APP_URL);
    if (
      !/^https?:$/.test(configured.protocol) ||
      configured.username ||
      configured.password
    )
      throw new ApiError(503, "INVALID_SITE_CONFIG", "站点地址配置不正确。");
    return configured.origin;
  }
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (!host) return url.origin;
  const external = new URL(`${url.protocol}//${host}`);
  if (external.host !== host || external.username || external.password)
    throw new ApiError(403, "INVALID_ORIGIN", "请求来源不受支持。");
  return external.origin;
}

export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  assertSameOrigin(request);
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new ApiError(400, "INVALID_CONTENT_TYPE", "请使用 JSON 请求。");
  const maxBytes = 300_000;
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new ApiError(413, "INPUT_TOO_LARGE", "请求内容过长。");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "INVALID_JSON", "缺少请求内容。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "INPUT_TOO_LARGE", "请求内容过长。");
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON 格式不正确。");
  }
  return schema.parse(body);
}

export function databaseError(
  error: { code?: string } | null,
  diagnostic?: { operation: "save_training_draft"; status: number },
) {
  if (!error) return;
  if (diagnostic) {
    // 仅保留 SQLSTATE/PostgREST 代码和 HTTP 状态；不记录 SDK message/details/hint。
    const code = /^(?:[A-Z0-9]{5}|PGRST[A-Z0-9]{3})$/.test(error.code ?? "")
      ? error.code
      : "UNKNOWN";
    console.warn("database_operation_failed", {
      operation: diagnostic.operation,
      status:
        Number.isInteger(diagnostic.status) &&
        diagnostic.status >= 0 &&
        diagnostic.status <= 599
          ? diagnostic.status
          : 0,
      code,
      category:
        code === "UNKNOWN"
          ? "transport_or_unclassified"
          : code?.startsWith("PGRST")
            ? "postgrest"
            : "postgresql",
    });
  }
  if (error.code === "P0002")
    throw new ApiError(404, "NOT_FOUND", "未找到可访问的记录。");
  if (
    error.code === "PT409" ||
    error.code === "40001" ||
    error.code === "23505"
  )
    throw new ApiError(
      409,
      "REVISION_CONFLICT",
      "数据已被其他请求更新，请先加载最新版本。",
    );
  if (error.code === "23514")
    throw new ApiError(409, "INVALID_TRANSITION", "当前状态不支持此操作。");
  if (error.code === "28000" || error.code === "42501")
    throw new ApiError(401, "UNAUTHENTICATED", "请重新登录。");
  throw new ApiError(
    503,
    "DATABASE_UNAVAILABLE",
    "数据库请求失败，请检查迁移是否已应用后重试。",
  );
}
