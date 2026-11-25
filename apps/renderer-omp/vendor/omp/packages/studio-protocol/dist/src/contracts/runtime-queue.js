export const RUNTIME_QUEUE_KINDS = [
    "session.compaction.enqueue", "session.compaction.cancel", "session.compaction.status",
    "session.queue.get",
    "session.queue.entry.remove",
    "session.queue.promote",
    "session.queue.edit",
    "session.queue.restore",
];
export function isRuntimeQueueKind(kind) {
    return RUNTIME_QUEUE_KINDS.includes(kind);
}
//# sourceMappingURL=runtime-queue.js.map