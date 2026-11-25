/** Fail-closed production replacement for the preview-only SSH preparation dialog. */
import { useI18n } from "../i18n";

type PreparationProfile = { name: string; kind?: string };
type PreparationStatus = { message?: string };

export function SshPreparationDialog({ profile, status, onCancel }: {
  profile: PreparationProfile;
  kind?: string;
  status: PreparationStatus;
  demo?: boolean;
  onApprove(): void;
  onCancel(): void;
}) {
  const { resolvedLanguage } = useI18n();
  const zh = resolvedLanguage === "zh";
  return <div role="alert" className="ssh-preparation-unavailable">
    <strong>{zh ? "SSH / WSL 工作区准备尚未实现。" : "SSH / WSL workspace preparation is not implemented."}</strong>
    <p>{profile.name}: {status.message ?? (zh ? "未启动任何外部连接。" : "No external connection was started.")}</p>
    <button type="button" className="btn outline" onClick={onCancel}>{zh ? "取消" : "Cancel"}</button>
  </div>;
}
