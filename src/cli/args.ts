export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }

    const [rawKey, inlineValue] = value.slice(2).split("=", 2);
    const nextValue = argv[index + 1];

    if (inlineValue !== undefined) {
      flags[rawKey] = inlineValue;
      continue;
    }

    if (nextValue && !nextValue.startsWith("--")) {
      flags[rawKey] = nextValue;
      index += 1;
      continue;
    }

    flags[rawKey] = "true";
  }

  return {
    positional,
    flags,
  };
}
