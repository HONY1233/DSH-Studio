/**
 * 进入应用时的全局提示（显示层，不进 Host / client-contract）。
 *
 * 「关闭」只收起本次会话；「不再提醒」把当前文案版本写入 localStorage。
 * 之后若要再提示一次，提高 STARTUP_NOTICE_ID 即可。
 */

export const STARTUP_NOTICE_ID = "incomplete-v1";
export const STARTUP_NOTICE_STORAGE_KEY = "omp.startupNotice.dismissed";
// 这是 DSH Studio 的本地构建，不再指向 OMP Studio 的仓库；留空时启动提示会隐藏仓库区块。
export const PROJECT_GITHUB_URL = "";
export const PROJECT_GITHUB_HOST = "";

export const STARTUP_NOTICE_COPY = {
  kicker: "开发预览",
  title: "应用尚未完成",
  body: "DSH Studio 目前仍在开发中，部分功能尚未完成。使用过程中可能遇到不稳定、缺失或与最终形态不一致的能力；DSH 运行时不支持的功能会在界面上直接给出中文说明。",
  hint: "如需反馈问题，请记录复现步骤，或在本地项目目录里留档。",
  repoLabel: "项目地址",
  thanks: "感谢使用 DSH Studio。",
} as const;

export const STARTUP_NOTICE_COPY_EN = {
  kicker: "Development preview",
  title: "Work in progress",
  body: "DSH Studio is still under active development and some features are incomplete. Capabilities the DSH runtime does not provide are reported inline in plain language.",
  hint: "To report a problem, note the reproduction steps or file it in the local project directory.",
  repoLabel: "Repository",
  thanks: "Thank you for trying DSH Studio.",
} as const;

export function getStartupNoticeCopy(zh: boolean) {
  return zh ? STARTUP_NOTICE_COPY : STARTUP_NOTICE_COPY_EN;
}

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* 存储被阻塞时「不再提醒」只活在本次会话。 */
  }
}

export function shouldShowStartupNotice(): boolean {
  return readStorage(STARTUP_NOTICE_STORAGE_KEY) !== STARTUP_NOTICE_ID;
}

export function dismissStartupNoticeForever(): void {
  writeStorage(STARTUP_NOTICE_STORAGE_KEY, STARTUP_NOTICE_ID);
}

/** 测试辅助：清掉持久化的「不再提醒」。 */
export function __resetStartupNoticeForTests(): void {
  try {
    globalThis.localStorage?.removeItem(STARTUP_NOTICE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
