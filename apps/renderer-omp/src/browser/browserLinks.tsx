import { useEffect, useRef, useState, type MouseEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSurfaceDocument } from "../dock/SurfaceContext";
import { useI18n } from "../i18n";
import { normalizeExternalUrl, normalizeMailtoUrl } from "./urlSafety";

/** 内置浏览器已下线，链接统一交给系统浏览器。 */
export function isHttpUrl(value: string): boolean {
  return normalizeExternalUrl(value) !== null;
}

function openExternalTarget(url: string): void {
  const openUrl = globalThis.ompStudioChrome?.openUrl;
  if (openUrl !== undefined) {
    void openUrl({ url });
    return;
  }
  globalThis.open(url, "_blank", "noopener,noreferrer");
}

export function openBrowserLink(url: string): void {
  const safeUrl = normalizeExternalUrl(url);
  if (safeUrl === null) return;
  openExternalTarget(safeUrl);
}

export function openMailtoLink(url: string): void {
  const safeUrl = normalizeMailtoUrl(url);
  if (safeUrl === null) return;
  openExternalTarget(safeUrl);
}

export function routeBrowserLink(url: string): boolean {
  const safeUrl = normalizeExternalUrl(url);
  if (safeUrl === null) return false;
  openBrowserLink(safeUrl);
  return true;
}

export interface SafeExternalLinkProps {
  href: string;
  children: ReactNode;
  className?: string | undefined;
  title?: string | undefined;
  "aria-label"?: string | undefined;
  "data-tip"?: string | undefined;
  onClick?: MouseEventHandler<HTMLAnchorElement> | undefined;
  onContextMenu?: MouseEventHandler<HTMLAnchorElement> | undefined;
}

/** Render untrusted external URLs as inert text unless strict parsing succeeds. */
export function SafeExternalLink({ href, children, className, title, "aria-label": ariaLabel, "data-tip": dataTip, onClick, onContextMenu }: SafeExternalLinkProps) {
  const safeHref = normalizeExternalUrl(href);
  if (safeHref === null) return <span className={className} title={title} aria-label={ariaLabel} data-tip={dataTip}>{children}</span>;
  return <a href={safeHref} target="_blank" rel="noreferrer noopener" className={className} title={title} aria-label={ariaLabel} data-tip={dataTip} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    openBrowserLink(safeHref);
  }} onContextMenu={onContextMenu}>{children}</a>;
}

export function BrowserLinkMenu({ url, point, onClose }: { url: string; point: { x: number; y: number }; onClose: () => void }) {
  const safeUrl = normalizeExternalUrl(url);
  const document = useSurfaceDocument();
  const { resolvedLanguage } = useI18n(); const zh = resolvedLanguage === "zh";
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", key); };
  }, [document, onClose]);
  if (safeUrl === null) return null;
  return createPortal(<div ref={ref} className="dropdown-menu browser-link-menu" role="menu" data-dock-modal="browser-link" style={{ position: "fixed", zIndex: 10000, left: Math.max(4, Math.min(point.x, (document.defaultView?.innerWidth ?? 600) - 240)), top: Math.max(4, Math.min(point.y, (document.defaultView?.innerHeight ?? 600) - 140)), width: 230 }}>
    <button type="button" className="menu-item" role="menuitem" onClick={() => { openBrowserLink(safeUrl); onClose(); }}>{zh ? "在系统浏览器打开" : "Open in system browser"}</button>
    <button type="button" className="menu-item" role="menuitem" onClick={() => { void document.defaultView?.navigator.clipboard.writeText(safeUrl); onClose(); }}>{zh ? "复制链接" : "Copy link"}</button>
  </div>, document.body);
}

export function BrowserLink({ href, children }: { href: string; children: ReactNode }) {
  const [menu, setMenu] = useState<{ x: number; y: number }>();
  const safeHref = normalizeExternalUrl(href), mailto = normalizeMailtoUrl(href);
  if (safeHref === null && mailto !== null) return <a href={mailto} target="_blank" rel="noreferrer noopener" onClick={event => { event.preventDefault(); openMailtoLink(mailto); }}>{children}</a>;
  return <><SafeExternalLink href={href} onContextMenu={event => { if (safeHref === null) return; event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }}>{children}</SafeExternalLink>{menu && safeHref !== null ? <BrowserLinkMenu url={safeHref} point={menu} onClose={() => setMenu(undefined)} /> : null}</>;
}
