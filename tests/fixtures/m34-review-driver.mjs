// Native Node test driver; no HTTP/DB and no production import. Actual CLI command implementation.
import { createInterface } from 'node:readline';
import { main } from '../../scripts/m34-review.mjs';
for await (const line of createInterface({ input: process.stdin })) {
    const { id, args } = JSON.parse(line);
    try {
        process.stdout.write(JSON.stringify({ id, ok: true, result: await main(args) }) + '\n');
    }
    catch (e) {
        process.stdout.write(JSON.stringify({ id, ok: false, error: e.code ?? 'INPUT_OR_OUTPUT_ERROR', fields: e.fields ?? [] }) + '\n');
    }
}
