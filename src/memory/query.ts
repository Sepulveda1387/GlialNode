export function buildSafeFtsQuery(input: string | undefined): string | undefined {
  const trimmed = input?.trim();

  if (!trimmed) {
    return undefined;
  }

  const tokenPattern = /"([^"]+)"|(\S+)/g;
  const tokens: string[] = [];

  for (const match of trimmed.matchAll(tokenPattern)) {
    const value = (match[1] ?? match[2] ?? "").trim();

    if (!value) {
      continue;
    }

    // Treat each token as a literal phrase to avoid raw FTS operator injection
    // or parser errors from punctuation-heavy user input.
    tokens.push(`"${value.replace(/"/g, "\"\"")}"`);
  }

  return tokens.length ? tokens.join(" AND ") : undefined;
}
