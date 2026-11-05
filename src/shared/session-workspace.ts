/** Working directories allocated for non-project conversations never become sidebar projects. */
export function isDefaultSessionDirectory(cwd: string | null | undefined): boolean {
  return !!cwd && /(?:^|[\\/])Serphia[\\/]\d{4}-\d{2}-\d{2}[\\/][a-f0-9]{32}[\\/]?$/i.test(cwd);
}

export const DIRECTORY_TOOL_NAMES = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"];

export function requiresSessionDirectory(name: string): boolean {
  return DIRECTORY_TOOL_NAMES.includes(name) || name.startsWith("herdr_") || name.startsWith("process_");
}
