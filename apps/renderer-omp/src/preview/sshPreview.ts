/** Preview-only SSH/WSL fixtures. Production builds replace this module with an empty boundary. */
export const PREVIEW_WSL_DIRECTORY = "/home/dev/project";
export const PREVIEW_WSL_DISTROS = [
  { name: "Ubuntu-24.04", version: 2, running: true, isDefault: true },
  { name: "Debian", version: 2, running: false, isDefault: false },
];
export const PREVIEW_SSH_TARGETS = [
  { id: "demo-linux", name: "dev-linux", platform: "linux" as const },
  { id: "demo-windows", name: "build-windows", platform: "win32" as const },
  { id: "demo-mac", name: "studio-mac", platform: "darwin" as const },
];
