/** Local paths are supplied by Vite so this boundary stays dependency-free. */
export function createProductionPreviewAliases(local: (path: string) => string) {
  return [
    // Match the complete specifier. Consuming only the trailing slash would
    // leave `./` or `../` before an absolute replacement in Vite's regex alias.
    { find: /^(?:.*\/)?computerPreview$/, replacement: local("./src/preview/computerPreview.production.ts") },
    { find: /^(?:.*\/)?sshPreview$/, replacement: local("./src/preview/sshPreview.production.ts") },
    { find: /^(?:.*\/)?agentBtwPreview$/, replacement: local("./src/preview/agentBtwPreview.production.ts") },
    { find: /^(?:.*\/)?nativeToolGallery$/, replacement: local("./src/preview/nativeToolGallery.production.ts") },
    { find: /^(?:.*\/)?SshPreparationDialog$/, replacement: local("./src/workspaces/SshPreparationDialog.production.tsx") },
    { find: /^(?:.*\/)?ExecutionTargetPicker$/, replacement: local("./src/workspaces/ExecutionTargetPicker.production.tsx") },
  ];
}
