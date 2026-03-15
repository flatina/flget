export interface ParsedCliArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg.startsWith("--")) {
      const [name, inlineValue] = arg.slice(2).split("=", 2);
      if (inlineValue !== undefined) {
        flags.set(name, inlineValue);
        continue;
      }

      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        flags.set(name, next);
        index += 1;
        continue;
      }

      flags.set(name, true);
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const name = arg.slice(1);
      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        flags.set(name, next);
        index += 1;
        continue;
      }

      flags.set(name, true);
      continue;
    }

    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
  }

  return { positional, flags };
}

export function getBooleanFlag(flags: Map<string, string | boolean>, name: string): boolean {
  return flags.get(name) === true;
}

export function getStringFlag(flags: Map<string, string | boolean>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}
