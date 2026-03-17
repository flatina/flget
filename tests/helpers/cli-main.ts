import { writeFile } from "node:fs/promises";

export function parseCliArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key || !key.startsWith("--")) {
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for CLI argument ${key}`);
    }
    args.set(key, value);
    index += 1;
  }
  return args;
}

export async function writeJsonUtf8(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function waitForExitSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}
