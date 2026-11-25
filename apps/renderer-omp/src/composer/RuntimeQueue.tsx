import { useEffect, useRef, useState } from "react";
import type { StudioClient } from "@omp-studio/client-contract";
import type { SessionQueueItem, SessionQueueSnapshot } from "@omp-studio/studio-protocol";
import { hostErrorMessage, waitReceipt } from "../hostError";
import { useI18n } from "../i18n";

type QueueCancelResult = {
  removed: boolean;
  status?: "cancelled" | "already-sent" | "already-cancelled" | string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function queueDisposition(value: unknown): string | undefined {
  const direct = record(value);
  const data = record(direct?.data);
  const status = direct?.status ?? data?.status;
  return typeof status === "string" ? status : undefined;
}

/** Only an explicit disposition or the exact legacy bridge receipt is non-error. */
function alreadySent(cause: unknown): boolean {
  const value = record(cause);
  if (queueDisposition(cause) === "already-sent") return true;
  return value?.code === "INVALID_STATE" && value.message === "already sent";
}

function alreadyCancelled(cause: unknown): boolean {
  return queueDisposition(cause) === "already-cancelled";
}

/** Authoritative Runtime queue. No send retry and no Renderer-owned flush loop. */
export function RuntimeQueue({
  client,
  sessionId,
  available,
  canRemove = false,
  running = false,
  pending = 0,
}: {
  client: StudioClient;
  sessionId: string | undefined;
  available: boolean;
  canRemove?: boolean;
  running?: boolean;
  pending?: number;
}) {
  const { resolvedLanguage } = useI18n();
  const zh = resolvedLanguage === "zh";
  const [offset, setOffset] = useState(0);
  const [snapshot, setSnapshot] = useState<SessionQueueSnapshot>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const locked = useRef(false);
  const reading = useRef(false);
  const queuedRead = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    epoch.current += 1;
    setSnapshot(undefined);
    setError("");
    setNotice("");
    return () => { epoch.current += 1; };
  }, [client, sessionId, available, offset]);

  useEffect(() => {
    const generation = epoch.current;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let total = pending;
    const poll = async () => {
      if (!active || !available || !sessionId || document.hidden) return;
      clearTimeout(timer);
      if (reading.current) {
        queuedRead.current = poll;
        return;
      }
      reading.current = true;
      try {
        const handle = await client.command("session.queue.list", { sessionId, ...(offset ? { offset } : {}) });
        const result = await waitReceipt<SessionQueueSnapshot>(client, handle.requestId, 10_000);
        if (active && epoch.current === generation) {
          total = result.total;
          if (!locked.current) {
            setSnapshot(result);
            if (offset >= result.total && offset > 0) {
              setOffset(Math.max(0, Math.floor(Math.max(0, result.total - 1) / 100) * 100));
            }
            setError("");
          }
        }
      } catch (cause) {
        if (active && epoch.current === generation && !locked.current) {
          setError(hostErrorMessage(cause, zh ? "队列状态不确定；不会自动重发" : "Queue state uncertain; messages will not be resent"));
        }
      } finally {
        reading.current = false;
        const next = queuedRead.current;
        queuedRead.current = undefined;
        if (next) next();
        else if (active && epoch.current === generation && !document.hidden && (running || pending > 0 || total > 0)) {
          timer = setTimeout(() => void poll(), 1500);
        }
      }
    };
    const visible = () => {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", visible);
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      if (queuedRead.current === poll) queuedRead.current = undefined;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client, sessionId, available, offset, running, pending]);

  useEffect(() => setOffset(0), [sessionId]);

  const remove = async (item: SessionQueueItem) => {
    if (!sessionId || locked.current || !canRemove) return;
    const owner = sessionId;
    const generation = epoch.current;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const handle = await client.command("session.queue.remove", { sessionId: owner, id: item.id });
      const result = await waitReceipt<QueueCancelResult>(client, handle.requestId);
      if (result.status === "already-sent" || result.status === "already-cancelled") {
        if (epoch.current === generation) {
          setNotice(result.status === "already-sent"
            ? (zh ? "消息已被 Runtime 消费，没有待取消项。" : "Message already sent; there is no pending item to cancel.")
            : (zh ? "消息已取消，没有待取消项。" : "Message already cancelled; there is no pending item to cancel."));
        }
        return;
      }
      if (!result.removed || (result.status !== undefined && result.status !== "cancelled")) {
        if (epoch.current === generation) {
          setError(zh ? "取消结果不明确；请刷新队列状态，不会自动重发。" : "Cancellation outcome is unknown; refresh the queue. Messages will not be resent.");
        }
        return;
      }
      if (epoch.current === generation) {
        setSnapshot((old) => old ? { ...old, items: old.items.filter((row) => row.id !== item.id), total: Math.max(0, old.total - 1) } : old);
      }
    } catch (cause) {
      if (epoch.current === generation) {
        if (alreadySent(cause)) {
          setNotice(zh ? "消息已被 Runtime 消费，没有待取消项。" : "Message already sent; there is no pending item to cancel.");
        } else if (alreadyCancelled(cause)) {
          setNotice(zh ? "消息已取消，没有待取消项。" : "Message already cancelled; there is no pending item to cancel.");
        } else {
          setError(hostErrorMessage(cause, zh ? "队列操作失败" : "Queue operation failed"));
        }
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return <>
    {snapshot && snapshot.total > 100 ? <div>
      <button className="btn small" disabled={busy || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 100))}>{zh ? "上一页" : "Previous"}</button>
      <span>{offset + 1}–{Math.min(offset + 100, snapshot.total)} / {snapshot.total}</span>
      <button className="btn small" disabled={busy || offset + 100 >= snapshot.total} onClick={() => setOffset((value) => value + 100)}>{zh ? "下一页" : "Next"}</button>
    </div> : null}
    {snapshot?.items.length ? <div className="queue-strip">
      <div className="qs-head-row">
        <span className="qs-title">{zh ? "Runtime 排队" : "Runtime queue"} ×{snapshot.total}</span>
        <span className="qs-note">follow-up: {snapshot.followUpMode} · steering: {snapshot.steeringMode}</span>
      </div>
      <div className="qs-list">{snapshot.items.map((item) => <div className="qs-item" key={item.id}>
        <span className="qs-text">{item.text}{item.imageCount ? ` · ${item.imageCount} ${zh ? "张图片" : "images"}` : ""}</span>
        <span className="qs-status">{item.queue} · {item.state === "recovering" ? (zh ? "已取回，待恢复草稿" : "Taken back; restore draft") : item.state === "pending" ? (zh ? "等待消费" : "Pending") : (zh ? "已接收" : "Delivering")}</span>
        <button className="btn small" disabled={busy || !canRemove || item.state === "delivering"} onClick={() => void remove(item)}>{zh ? "取消" : "Cancel"}</button>
      </div>)}</div>
    </div> : null}
    {error ? <p className="small" role="alert">{error}</p> : null}
    {notice ? <p className="small" role="status">{notice}</p> : null}
  </>;
}
