import { codeTextSchema, MAX_CODE_BYTES, hasControlCharacters } from "@/lib/validation/review";
/** Reads only the single File explicitly selected by the user; no upload endpoint. */
export async function readCodeFile(file: File) {
    if (!/\.(cpp|cc|cxx|txt)$/i.test(file.name) || file.name.length > 160 || (/[\\/]/.test(file.name) || hasControlCharacters(file.name)))
        throw new Error("请选择 .cpp / .cc / .cxx / .txt 文件。");
    if (!["", "text/plain", "text/x-c++src", "text/x-c++", "text/x-c", "application/octet-stream"].includes(file.type))
        throw new Error("文件类型不受支持。");
    if (!file.size || file.size > MAX_CODE_BYTES)
        throw new Error("文件必须为 1–64000 字节。");
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    }
    catch {
        throw new Error("文件必须使用 UTF-8 编码，请在本地编辑器转换后重试。");
    }
    const result = codeTextSchema.safeParse(text);
    if (!result.success)
        throw new Error("文件包含无效文本或二进制内容。");
    return result.data;
}
