export interface ParsedCliArgs {
  positional: string[];
  flags: Map<string, FlagValue>;
}

export type FlagValue = string | boolean | string[];

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positional: string[] = [];
  const flags = new Map<string, FlagValue>();

  function pushFlagValue(name: string, value: string | boolean): void {
    const existing = flags.get(name);
    if (existing === undefined) {
      flags.set(name, value);
      return;
    }
    if (typeof existing === "boolean" || typeof value === "boolean") {
      flags.set(name, value);
      return;
    }
    if (Array.isArray(existing)) {
      flags.set(name, [...existing, value]);
      return;
    }
    flags.set(name, [existing, value]);
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg.startsWith("--")) {
      const [name, inlineValue] = arg.slice(2).split("=", 2);
      if (inlineValue !== undefined) {
        pushFlagValue(name, inlineValue);
        continue;
      }

      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        pushFlagValue(name, next);
        index += 1;
        continue;
      }

      pushFlagValue(name, true);
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const name = arg.slice(1);
      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        pushFlagValue(name, next);
        index += 1;
        continue;
      }

      pushFlagValue(name, true);
      continue;
    }

    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
  }

  return { positional, flags };
}

export function getBooleanFlag(flags: Map<string, FlagValue>, name: string): boolean {
  return flags.get(name) === true;
}

export function getStringFlag(flags: Map<string, FlagValue>, name: string): string | undefined {
  const value = flags.get(name);
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

export function getStringFlags(flags: Map<string, FlagValue>, name: string): string[] {
  const value = flags.get(name);
  if (Array.isArray(value)) {
    return value;
  }
  return typeof value === "string" ? [value] : [];
}
