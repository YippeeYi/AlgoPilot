import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import TutorMarkdown from "@/components/practice/tutor-markdown";
describe("M2 安全 Markdown + KaTeX 实际渲染", () => {
  it("支持公式、列表和代码，禁 HTML/危险 URL/远程图片", () => {
    const { container } = render(
      <TutorMarkdown
        content={
          "**结论**\n\n$O(n^2)$\n\n- 边界\n\n```cpp\nint x=1;\n```\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))\n\n![跟踪](https://fixture.invalid/pixel)"
        }
      />,
    );
    expect(container.querySelector("strong")).toHaveTextContent("结论");
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector("code")).toHaveTextContent("int x=1;");
    expect(container.querySelectorAll("script,a,img,iframe")).toHaveLength(0);
  });
  it("KaTeX trust:false 禁止数学中的链接和外部资源", () => {
    const { container } = render(
      <TutorMarkdown
        content={
          "$\\href{javascript:alert(1)}{x}$\n\n$\\includegraphics{https://fixture.invalid/pixel}$"
        }
      />,
    );
    expect(container.querySelectorAll("a,img,script")).toHaveLength(0);
  });
});
