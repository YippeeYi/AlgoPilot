import { z } from "zod";
export const cfPageSize = 200;
export const cfOverlap = 40;
export const cfCursorSchema = z.object({ from: z.number().int().positive(), anchor: z.number().nullable(), top: z.number().nullable(), stop: z.number().nullable(), cycle: z.uuid(), probe: z.boolean(), done: z.boolean(), gaps: z.number().int().nonnegative() }).strict();
export type CfCursor = z.infer<typeof cfCursorSchema>;
export function initialCfCursor(cycle: string, stop: number | null = null): CfCursor { return { from: 1, anchor: null, top: null, stop, cycle, probe: false, done: false, gaps: 0 }; }
// An empty EOF probe is required; short pages or a request budget never mean complete.
// Losing an overlap anchor invalidates this traversal; retry from the head without losing facts.
export function advanceCfCursor(c: CfCursor, ids: number[], newCycle: string, head = false): CfCursor {
    if (c.done) throw new Error("Cursor already finished");
    if (ids.length > cfPageSize || ids.some((id, i) => !Number.isSafeInteger(id) || id <= 0 || (i > 0 && id >= ids[i - 1]!))) throw new Error("Invalid descending page");
    if (!ids.length && (c.from === 1 || c.probe)) return { ...c, done: true };
    if (c.probe || (c.anchor !== null && !ids.includes(c.anchor))) return { ...initialCfCursor(newCycle, c.stop), gaps: c.gaps + 1 };
    const top = c.top ?? ids[0] ?? null;
    if (head && (c.stop === null || ids.some(id => id <= c.stop!))) return { ...c, top, done: true };
    return { ...c, top, anchor: ids.at(-1) ?? null, from: c.from + (ids.length < cfPageSize ? ids.length : cfPageSize - cfOverlap), probe: ids.length < cfPageSize, done: false };
}
