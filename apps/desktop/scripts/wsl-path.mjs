import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function isWindowsAbsolutePath(value) {
  return typeof value === 'string' && (/^[A-Za-z]:[\\/]/u.test(value) || /^\\\\[^\\]+\\[^\\]+/u.test(value))
}

/** Convert a real Windows path through WSL's own mount rules instead of assuming /mnt/<drive>. */
export async function resolveWslCwd(value, { distro = 'ubuntu', execute = execFileAsync } = {}) {
  if (typeof value !== 'string' || !value) throw new Error('WSL cwd must be an absolute Windows or POSIX path')
  if (/[\r\n\0]/u.test(value)) throw new Error('Invalid WSL cwd')
  if (typeof distro !== 'string' || !distro || /[\r\n\0]/u.test(distro)) throw new Error('Invalid WSL distro')
  if (value.startsWith('/')) {
    if (value.includes('\n') || value.includes('\r') || value.includes('\0')) throw new Error('Invalid WSL cwd')
    return value
  }
  if (!isWindowsAbsolutePath(value)) throw new Error('WSL cwd must be an absolute Windows or POSIX path')
  // wsl.exe parses backslashes as command-line escapes. Forward slashes are
  // accepted by wslpath and preserve the actual path across that boundary.
  const windowsPath = value.replaceAll('\\', '/')
  const { stdout } = await execute('wsl.exe', ['-d', distro, '--', 'wslpath', '-u', windowsPath], { windowsHide: true })
  const converted = String(stdout).trim()
  if (!converted.startsWith('/') || /[\r\n\0]/u.test(converted)) throw new Error('wslpath returned an invalid WSL path')
  return converted
}
