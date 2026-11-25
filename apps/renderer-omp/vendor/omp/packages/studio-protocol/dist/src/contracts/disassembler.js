export const DISASSEMBLER_VIEWS = ["overview", "pseudocode", "asm", "functions", "strings", "imports", "exports", "xrefs"];
export const DISASSEMBLER_KINDS = [
    "disassembler.status", "disassembler.configure", "disassembler.metadata.read", "disassembler.open",
    "disassembler.close", "disassembler.save", "disassembler.run", "disassembler.cancel",
    "disassembler.query", "disassembler.edit.prepare", "disassembler.edit.apply",
];
export function isDisassemblerKind(kind) {
    return DISASSEMBLER_KINDS.includes(kind);
}
//# sourceMappingURL=disassembler.js.map