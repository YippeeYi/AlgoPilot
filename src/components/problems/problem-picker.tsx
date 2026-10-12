"use client";
import { useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { requestJson } from "@/lib/api-client";
import { cfKey, type CatalogPage, type CatalogProblem } from "@/lib/validation/m3";
export function ProblemPicker({ onSelect, disabled = false }: {
    onSelect: (p: CatalogProblem) => void;
    disabled?: boolean;
}) {
    const [query, setQuery] = useState("");
    const [items, setItems] = useState<CatalogProblem[]>([]);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    async function search() { setBusy(true); setError(""); try {
        const r = await requestJson<CatalogPage>(`/api/v1/problems?limit=10&q=${encodeURIComponent(query)}`);
        setItems(r.items);
        if (!r.items.length)
            setError("没有匹配的 Codeforces 题目。");
    }
    catch (e) {
        setError(e instanceof Error ? e.message : "选题失败。");
    }
    finally {
        setBusy(false);
    } }
    return <div className="space-y-3"><label className="block text-sm">选择 Codeforces 题目<Input aria-label="CF 题号或 URL" placeholder="1538D / 1732C1 / 官方题目 URL" value={query} maxLength={200} onChange={e => setQuery(e.target.value)} disabled={disabled}/></label><Button type="button" variant="outline" disabled={disabled || busy} onClick={() => void search()}>查找 CF 题目</Button> <Link href="/problems" className="text-sm underline">浏览完整题库</Link>{error && <p role="alert">{error}</p>}<div className="flex flex-col gap-2">{items.map(p => <Button key={p.id} type="button" variant="outline" className="h-auto justify-start whitespace-normal text-left" disabled={disabled} onClick={() => { onSelect(p); setItems([]); setQuery(cfKey(p.contestId, p.index)); }}>选择 {cfKey(p.contestId, p.index)} · {p.name} · {p.rating ?? "未定级"}</Button>)}</div></div>;
}
