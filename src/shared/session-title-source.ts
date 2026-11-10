/** Remove standalone skill references from text used only to create a session title. */
export function sessionTitleMessage(message: string): string {
  return message
    .replace(/(^|\s)(@"[^"\n]*"|`[^`\n]*`|\/skill:[^\s]+)(?=\s|$)/g, (match, boundary: string, token: string) =>
      token.startsWith("/skill:") ? boundary : match,
    )
    .trim();
}

/** Give skill-only first messages a readable temporary label without showing command syntax. */
export function sessionTitleFallback(message: string): string {
  const text = sessionTitleMessage(message);
  if (text) return text;
  const names = [...message.matchAll(/(?:^|\s)\/skill:([^\s]+)(?=\s|$)/g)].map((match) => match[1]);
  return names.join(", ");
}
