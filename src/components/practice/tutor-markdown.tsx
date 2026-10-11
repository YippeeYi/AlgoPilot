"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
// Sanitize before KaTeX; no rehype-raw. Only trusted KaTeX expands sanitized math.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", "language-math", "math-inline", "math-display"],
    ],
  },
};
export default function TutorMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-2 overflow-x-auto text-sm leading-7 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-inside [&_ul]:list-disc [&_ol]:list-inside [&_ol]:list-decimal [&_.katex-display]:overflow-x-auto">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeSanitize, schema],
          [
            rehypeKatex,
            {
              trust: false,
              strict: "error",
              throwOnError: false,
              maxExpand: 100,
              maxSize: 10,
            },
          ],
        ]}
        components={{
          a: ({ children }) => <span>{children}</span>,
          img: () => null,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
