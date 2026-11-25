export const ANNOTATION_OPERATION_KINDS = ["annotations.capture", "annotations.prepare"];
const byteLength = (text) => new TextEncoder().encode(text).byteLength;
function object(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid annotation object");
    const row = value;
    if (Object.keys(row).some(key => !keys.includes(key)))
        throw new Error("Unknown annotation field");
    return row;
}
function text(value, max = 512, empty = false) { if (typeof value !== "string" || (!empty && !value.trim()) || value.includes("\0") || value.length > max)
    throw new Error("Invalid annotation text"); }
function integer(value, min = 0) { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    throw new Error("Invalid annotation offset"); }
function relative(value) { text(value, 4096); if (/^(?:[A-Za-z]:|[\\/])/u.test(value) || value.split(/[\\/]/u).includes(".."))
    throw new Error("Annotation paths must be workspace-relative"); }
function source(value) {
    const row = object(value, ["id", "kind", "label", "text", "version", "path", "sessionId", "messageId"]);
    text(row.id);
    text(row.label);
    text(row.text, 120000, true);
    if (!["message", "quote", "file", "diff"].includes(row.kind))
        throw new Error("Invalid annotation source kind");
    if (typeof row.version !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(row.version))
        throw new Error("Invalid annotation source version");
    if (row.path !== undefined)
        relative(row.path);
    if (row.kind === "file" && row.path === undefined)
        throw new Error("Missing annotation file");
    if (row.sessionId !== undefined)
        text(row.sessionId);
    if (row.messageId !== undefined)
        text(row.messageId);
}
function content(sources, notes) {
    if (!Array.isArray(sources) || sources.length > 16 || !Array.isArray(notes) || notes.length > 128)
        throw new Error("Annotation bundle exceeds its limit");
    const sourceMap = new Map();
    for (const item of sources) {
        source(item);
        if (sourceMap.has(item.id))
            throw new Error("Duplicate annotation source");
        sourceMap.set(item.id, item);
    }
    const noteIds = new Set();
    for (const item of notes) {
        const row = object(item, ["id", "sourceId", "note", "selection"]);
        text(row.id);
        text(row.sourceId);
        text(row.note, 8000);
        if (noteIds.has(row.id))
            throw new Error("Duplicate annotation");
        noteIds.add(row.id);
        const linked = sourceMap.get(row.sourceId);
        if (!linked)
            throw new Error("Annotation source is missing");
        if (row.selection !== undefined) {
            const range = object(row.selection, ["start", "end"]);
            integer(range.start);
            integer(range.end, 1);
            if (range.start >= range.end || range.end > linked.text.length)
                throw new Error("Annotation selection is outside the source");
        }
    }
    if (byteLength(JSON.stringify({ sources, notes })) > 750000)
        throw new Error("Annotation bundle is too large; split it into smaller groups");
}
export function validateAnnotationBundle(value) {
    const row = object(value, ["schemaVersion", "revision", "sources", "notes", "workspaceId", "sessionId"]);
    if (row.schemaVersion !== 1)
        throw new Error("Unsupported annotation format");
    integer(row.revision, 1);
    if (row.workspaceId !== undefined)
        text(row.workspaceId);
    if (row.sessionId !== undefined)
        text(row.sessionId);
    content(row.sources, row.notes);
}
//# sourceMappingURL=annotations.js.map