"use client";

import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/cpp/register.js";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

// 全部编辑器资源/worker 来自本机静态文件，不加载 CDN。
// 从 npm ESM 源码构建，确保使用锁定的 DOMPurify 官方安全补丁，而非旧预编译 AMD 包。
loader.config({ monaco });
globalThis.MonacoEnvironment = {
  getWorkerUrl: () => "/monaco/editor.worker.js",
};

export default function CodeEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const [plain, setPlain] = useState(false);
  return (
    <div>
      <div className="mb-2 flex justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          C++ · 仅编辑，不执行
        </span>
        <Button size="sm" variant="ghost" onClick={() => setPlain(!plain)}>
          {plain ? "使用 Monaco" : "使用文本编辑器"}
        </Button>
      </div>
      {plain ? (
        <Textarea
          aria-label="C++ 草稿"
          className="min-h-72 font-mono text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          maxLength={64000}
          spellCheck={false}
        />
      ) : (
        <div
          className="overflow-hidden rounded-lg border"
          aria-label="C++ 编辑器"
        >
          <Editor
            height="300px"
            defaultLanguage="cpp"
            value={value}
            onChange={(code) => onChange(code ?? "")}
            theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
            loading={
              <p role="status" className="p-4 text-sm">
                正在加载编辑器；若加载失败可切换文本编辑器。
              </p>
            }
            options={{
              readOnly,
              minimap: { enabled: false },
              automaticLayout: true,
              fontSize: 13,
              scrollBeyondLastLine: false,
              tabSize: 2,
              wordWrap: "on",
            }}
          />
        </div>
      )}
    </div>
  );
}
