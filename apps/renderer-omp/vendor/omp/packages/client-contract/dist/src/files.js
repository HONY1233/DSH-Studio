/** System paths belong to the selected Host, including references relative to that Host's home. */
export function isSystemFilePath(path) {
    return /^(?:[A-Za-z]:[\\/]|[\\/]|~(?:[\\/]|$)|file:)/i.test(path);
}
//# sourceMappingURL=files.js.map