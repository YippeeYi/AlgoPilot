// Offline metadata comparison. Never connects to a database or mutates a ledger.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
type Row = Record<string, unknown>;
type Audit = { serverVersion: string; migrationHistoryExists: boolean } & Record<string, unknown>;
const sections = {
    functions: ["signature"], relations: ["schema", "name"], columns: ["schema", "table", "name"],
    indexes: ["schema", "table", "name"], constraints: ["schema", "table", "name"],
    policies: ["schema", "table", "name"], triggers: ["schema", "table", "name"],
};
const canonical = (v: unknown): string => JSON.stringify(v, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
const hash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
function rows(audit: Audit, section: string): Row[] {
    const value = audit[section];
    if (!Array.isArray(value) || value.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Invalid catalog metadata");
    return value;
}
export function compareStructure(local: Audit, hosted: Audit) {
    const results: Record<string, unknown> = {};
    let mismatchCount = 0;
    const compatibleNotNull = Number.parseInt(local.serverVersion) >= 18 && Number.parseInt(hosted.serverVersion) < 18;
    const hostedColumns = rows(hosted, "columns");
    for (const [section, fields] of Object.entries(sections)) {
        const key = (row: Row) => canonical(fields.map(field => row[field]));
        const expected = new Map(rows(local, section).map(row => [key(row), row]));
        const actual = new Map(rows(hosted, section).map(row => [key(row), row]));
        if (expected.size !== rows(local, section).length || actual.size !== rows(hosted, section).length) throw new Error("Duplicate catalog identity");
        const differences: { key: string; fields: string[] }[] = [], equivalentColumnNotNull: string[] = [];
        for (const [id, row] of expected) {
            const found = actual.get(id);
            if (!found) {
                // PG18 stores NOT NULL in pg_constraint. PG17 still enforces attnotnull.
                // Never excuse a missing check/unique/FK constraint or nullable hosted column.
                const column = hostedColumns.find(c => c.schema === row.schema && c.table === row.table
                    && [ `NOT NULL ${String(c.name)}`, `NOT NULL "${String(c.name).replaceAll('"', '""')}"` ].includes(String(row.definition)) && c.notNull === true);
                if (section === "constraints" && compatibleNotNull && column) { equivalentColumnNotNull.push(id); continue; }
                differences.push({ key: id, fields: ["missing"] }); continue;
            }
            const changed = Object.keys(row).filter(field => canonical(row[field]) !== canonical(found[field]));
            if (changed.length) differences.push({ key: id, fields: changed });
        }
        mismatchCount += differences.length;
        results[section] = { expected: expected.size, hosted: actual.size, matched: expected.size - differences.length - equivalentColumnNotNull.length,
            equivalentColumnNotNull, differences, extraObjectsNotAttested: [...actual.keys()].filter(id => !expected.has(id)) };
    }
    return { boundary: "Effective 001-010 metadata only. Does not attest migration execution history, private settings, runtime RLS or platform extras.",
        localVersion: local.serverVersion, hostedVersion: hosted.serverVersion, migrationHistoryExists: hosted.migrationHistoryExists,
        localMetadataSha256: hash(local), hostedMetadataSha256: hash(hosted), mismatchCount, sections: results };
}
async function run() {
    const [local, hosted, output] = process.argv.slice(2);
    if (!local || !hosted || !output) throw new Error("Three paths required");
    const result = compareStructure(JSON.parse(await readFile(local, "utf8")), JSON.parse(await readFile(hosted, "utf8")));
    await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ operation: "compare_structure", mismatchCount: result.mismatchCount, written: true }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { await run(); } catch { console.error(JSON.stringify({ operation: "compare_structure", written: false, error: "invalid_metadata_or_io" })); process.exitCode = 1; }
}
