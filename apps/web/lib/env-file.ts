// Sets KEY to a single-quoted value in .env text, in place or appended. Single quotes keep compose and Node's env-file
// parsers from expanding the $ an argon2 hash holds, and the function replacer keeps $ in the value literal.
export function setEnvValue(text: string, key: string, value: string) {
  if (/['\r\n]/.test(value)) throw new Error(`${key} cannot hold a quote or a line break`);
  const line = `${key}='${value}'`;
  const existing = new RegExp(`^${key}=.*$`, 'm');
  if (existing.test(text)) return text.replace(existing, () => line);
  return `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`;
}
