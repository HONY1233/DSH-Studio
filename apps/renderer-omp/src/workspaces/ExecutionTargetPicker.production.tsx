/**
 * X0 product boundary: SSH/WSL preparation is not implemented. The preview
 * picker and its fixture data are excluded from the product build entirely.
 */
import { useI18n } from "../i18n";

export function ExecutionTargetPicker(_props: { onOpen?(): void; otherMenuOpen?: boolean }) {
  const { resolvedLanguage } = useI18n();
  const zh = resolvedLanguage === "zh";
  const label = zh ? "此计算机" : "This computer";
  const reason = zh ? "SSH / WSL 工作区尚未实现" : "SSH / WSL workspaces are not implemented";
  return <button type="button" className="execution-target-unavailable" disabled title={reason} aria-label={`${label} · ${reason}`}>
    {label}
  </button>;
}
