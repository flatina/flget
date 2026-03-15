export function parseToml(text: string): unknown {
  return Bun.TOML.parse(text);
}

export function parseYaml(text: string): unknown {
  return Bun.YAML.parse(text);
}

export async function readRuntimeText(path: string): Promise<string> {
  return Bun.file(path).text();
}

export async function readRuntimeArrayBuffer(path: string): Promise<ArrayBuffer> {
  return Bun.file(path).arrayBuffer();
}

export async function readRuntimeBytes(path: string): Promise<Uint8Array> {
  return Bun.file(path).bytes();
}

export async function writeRuntimeBytes(path: string, value: Uint8Array | ArrayBuffer): Promise<void> {
  await Bun.write(path, value as ArrayBuffer | SharedArrayBuffer | Uint8Array);
}

export async function scanGlob(pattern: string, cwd: string): Promise<string[]> {
  return Array.fromAsync(new Bun.Glob(pattern).scan(cwd));
}

export interface SpawnProcessOptions {
  cmd: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdout?: "pipe" | "inherit" | "ignore";
  stderr?: "pipe" | "inherit" | "ignore";
}

export function spawnProcess(options: SpawnProcessOptions): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  return Bun.spawn(options as never) as Bun.Subprocess<"pipe", "pipe", "pipe">;
}
