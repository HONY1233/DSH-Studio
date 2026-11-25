/** Public artifact facts. Storage roots and absolute payload paths stay private. */
export const ARTIFACT_KINDS = ["graphic", "image", "video", "audio", "transcript", "judgment", "benchmark", "recording", "annotation", "export"];
export const ARTIFACT_TEXT_MAX_BYTES = 800000;
export function validateArtifactTextInput(value) {
    const input = object(value, ["kind", "name", "text", "workspaceId", "sessionId", "runId"]);
    if (!["annotation", "judgment", "benchmark", "transcript", "export"].includes(input.kind))
        throw new Error("Invalid text artifact kind");
    short(input.name);
    if (/[\\/]/u.test(input.name) || !/\.(?:json|jsonl|txt|md|csv)$/iu.test(input.name))
        throw new Error("Choose a text artifact filename");
    for (const key of ["workspaceId", "sessionId", "runId"])
        short(input[key], true);
    if (typeof input.text !== "string" || new TextEncoder().encode(input.text).byteLength > ARTIFACT_TEXT_MAX_BYTES || input.text.includes("\0"))
        throw new Error("Text artifact exceeds its limit or contains binary data");
}
function object(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected artifact object");
    const record = value;
    if (Object.keys(record).some(key => !keys.includes(key)))
        throw new Error("Unknown artifact field");
    return record;
}
function short(value, optional = false) {
    if (value === undefined && optional)
        return;
    if (typeof value !== "string" || !value.trim() || value.length > 1024 || /[\u0000-\u001f]/u.test(value))
        throw new Error("Invalid artifact text");
}
//# sourceMappingURL=artifacts.js.map