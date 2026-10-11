import "server-only";
import { z } from "zod";

type ConfigurationState = "missing" | "incomplete" | "configured";
const httpsUrl = z.url({ protocol: /^https$/ });

function state(
  values: (string | undefined)[],
  valid: boolean,
): ConfigurationState {
  if (values.every((value) => !value?.trim())) return "missing";
  return valid ? "configured" : "incomplete";
}

// 只返回枚举。禁止将 process.env 或校验错误对象传给客户端。
export function getConfigurationStatus(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const llmUrl = env.LLM_BASE_URL;
  const llmKey = env.LLM_API_KEY;
  const llmModel = env.LLM_MODEL;
  return {
    supabase: state(
      [supabaseUrl, supabaseKey],
      httpsUrl.safeParse(supabaseUrl).success && Boolean(supabaseKey?.trim()),
    ),
    llm: state(
      [llmUrl, llmKey, llmModel],
      httpsUrl.safeParse(llmUrl).success &&
        Boolean(llmKey?.trim()) &&
        Boolean(llmModel?.trim()),
    ),
  };
}
