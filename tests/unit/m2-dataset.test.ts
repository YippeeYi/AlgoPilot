import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { modelOutputSchema } from "@/lib/validation/m2";
import { auditOutput } from "@/server/tutor/audit";
const cases = z
  .array(
    z.object({
      id: z.string(),
      topic: z.string(),
      thought: z.string(),
      approvedFixtureOutput: modelOutputSchema,
      rejectedFixtureOutput: modelOutputSchema,
      realModelReviewed: z.boolean(),
    }),
  )
  .min(10)
  .parse(
    JSON.parse(readFileSync("docs/tutor/teaching-review-dataset.json", "utf8")),
  );
describe("原创 12 题教学审核集（固定输出夹具，非真实模型质量）", () => {
  it("覆盖六类策略且不伪称完成人工审核", () => {
    expect(new Set(cases.map((c) => c.topic)).size).toBe(6);
    expect(cases.every((c) => !c.realModelReviewed)).toBe(true);
  });
  for (const c of cases)
    it(`${c.id}: 低等级拒绝题解，审核提问引用实际思路`, () => {
      const input = {
        allowedLevel: 0,
        action: "validate" as const,
        thought: c.thought,
        previousAssistant: [],
        secrets: [],
      };
      const visible = auditOutput(
        JSON.stringify(c.approvedFixtureOutput),
        input,
      );
      expect(visible.disclosureLevel).toBe(0);
      expect(visible.content).toContain(
        c.thought.replace(/[\\`*_{}[\]()#+.!<>$|~-]/g, "\\$&"),
      );
      expect(() =>
        auditOutput(JSON.stringify(c.rejectedFixtureOutput), input),
      ).toThrow();
    });
});
