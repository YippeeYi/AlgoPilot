import { it, expect } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { database } from "./database";
import { compareStructure } from "../../scripts/m35-compare-structure";

it("normalizes PG18 NOT NULL catalog rows only when the hosted column enforces NOT NULL", () => {
    const base = { serverVersion: "18.3", migrationHistoryExists: false, functions: [], relations: [], indexes: [], policies: [], triggers: [],
        columns: [{ schema: "public", table: "example", name: "id", notNull: true }],
        constraints: [{ schema: "public", table: "example", name: "example_id_not_null", definition: "NOT NULL id" }] };
    const host = { ...base, serverVersion: "17.11", constraints: [] };
    expect(compareStructure(base, host).mismatchCount).toBe(0);
    expect(compareStructure({ ...base, constraints: [{ ...base.constraints[0], definition: 'NOT NULL "id"' }] }, host).mismatchCount).toBe(0);
    expect(compareStructure(base, { ...host, columns: [{ ...base.columns[0], notNull: false }] }).mismatchCount).toBeGreaterThan(0);
    expect(compareStructure({ ...base, constraints: [{ ...base.constraints[0], definition: "CHECK (id > 0)" }] }, host).mismatchCount).toBe(1);
    expect(compareStructure(base, { ...host, serverVersion: "18.3" }).mismatchCount).toBe(1);
});

it("audits the effective 001-010 structure with catalog SELECT only, including historical RPCs and guards", async () => {
    const sql = await readFile("docs/sql/M35_READONLY_STRUCTURE.sql", "utf8");
    const code = sql.replace(/--[^\n]*/g, "").trim();
    expect(code.startsWith("select ")).toBe(true);
    expect(code.replace(/'(?:''|[^'])*'/g, "''").match(/;/g)).toHaveLength(1);
    const db = await database();
    try {
        const audit = (await db.query<{ audit: { functions: { signature: string }[]; relations: { name: string }[]; triggers: { name: string }[] } }>(sql)).rows[0]!.audit;
        expect(audit.functions.map(f => f.signature)).toEqual(expect.arrayContaining([
            "public.cf_account_state()", "public.cf_account_command(p_payload text, p_signature text)",
            "public.learning_candidates(p_query jsonb)", "public.learning_evidence()",
            "public.save_training_draft(p_id uuid, p_kind text, p_content text, p_expected_revision integer)",
        ]));
        expect(audit.relations.map(r => r.name)).toEqual(expect.arrayContaining(["profiles", "training_sessions", "thought_snapshots", "tutor_requests", "review_requests", "cf_accounts"]));
        expect(audit.triggers.map(t => t.name)).toContain("initialize_profile");
        const output = process.env.M35_EVALUATION_OUTPUT;
        if (output) {
            await mkdir(output, { recursive: true });
            await writeFile(`${output}/local-structure.json`, JSON.stringify(audit, null, 2) + "\n");
        }
    } finally { await db.close(); }
}, 30000);
