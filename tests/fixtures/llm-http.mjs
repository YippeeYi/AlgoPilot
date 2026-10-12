// Local Chat Completions HTTP mock. Not an actual provider or teaching-quality evaluation.
import { createServer } from "node:http";
let calls = 0;
createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:54002");
  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/health") {
    res.end(JSON.stringify({ ready: true }));
    return;
  }
  if (url.pathname === "/metrics") {
    res.end(JSON.stringify({ calls }));
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (req.headers.authorization !== "Bearer fixture-llm-key-not-real") {
    res.statusCode = 401;
    res.end("{}");
    return;
  }
  calls++;
  const system = body.messages[0].content;
  if(system.includes("algopilot-ac-review/")) {
    const analysis={summary:"[MOCK] 算法总结",correctness:"[MOCK] 静态证明摘要，未运行代码。",assumptions:"[MOCK] 输入范围待确认。",timeComplexity:"[MOCK] O(1)",spaceComplexity:"[MOCK] O(1)",lineAnalysis:[{start:1,end:1,analysis:"[MOCK] 程序入口。"}],risks:"[MOCK] 边界待检查。",improvements:"[MOCK] 改善命名。",alternatives:"",transferableKnowledge:"[MOCK] 复杂度推导。",revisionQuestions:["[MOCK] 输入前提是什么？"],answer:"[MOCK] 追问回答。"};
    res.end(JSON.stringify({model:"fixture-http-model",choices:[{finish_reason:"stop",message:{role:"assistant",content:JSON.stringify(analysis)}}],usage:{prompt_tokens:123,completion_tokens:45,total_tokens:168}}));return;
  }
  const level = Number(system.match(/有效等级 L(\d)/)?.[1] ?? 0);
  const data = JSON.parse(
    body.messages.at(-1).content.split("训练数据：\n")[1],
  );
  if (data.request.includes("模拟上游失败")) {
    res.statusCode = 500;
    res.end("{}");
    return;
  }
  const output = {
    disclosureLevel: level,
    focus: "proof",
    quote: level <= 1 ? data.thought.slice(0, 100) : "",
    content:
      level <= 1
        ? ""
        : level === 5
          ? "[MOCK] 完整解析测试消息：$O(n)$。这只是本地 HTTP 契约测试。"
          : "[MOCK] 请检查当前条件的适用范围。这个依据对边界输入成立吗？",
  };
  res.end(
    JSON.stringify({
      model: "fixture-http-model",
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify(output) },
        },
      ],
      usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
    }),
  );
}).listen(54002, "127.0.0.1");
