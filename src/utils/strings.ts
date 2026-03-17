import { basename, extname } from "node:path";
import type { ShimDef, ShimRunner } from "../core/types";

const EXTENSION_MAP: Record<string, { type: ShimDef["type"]; runner: ShimRunner }> = {
  ".exe": { type: "exe", runner: "direct" },
  ".com": { type: "exe", runner: "direct" },
  ".cmd": { type: "cmd", runner: "cmd" },
  ".bat": { type: "cmd", runner: "cmd" },
  ".ps1": { type: "ps1", runner: "powershell" },
  ".jar": { type: "jar", runner: "java" },
  ".py":  { type: "py",  runner: "python" },
  ".js":  { type: "js",  runner: "bun" },
  ".cjs": { type: "js",  runner: "bun" },
  ".mjs": { type: "js",  runner: "bun" },
  ".ts":  { type: "ts",  runner: "bun" },
  ".cts": { type: "ts",  runner: "bun" },
  ".mts": { type: "ts",  runner: "bun" },
  ".sh":  { type: "other", runner: "bash" },
};

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "package";
}

export function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = `^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`;
  return new RegExp(regex, "i");
}

export function detectShimType(target: string): ShimDef["type"] {
  return EXTENSION_MAP[extname(target).toLowerCase()]?.type ?? "other";
}

export function inferShimRunner(target: string): ShimRunner | undefined {
  return EXTENSION_MAP[extname(target).toLowerCase()]?.runner;
}

export function deriveShimName(target: string): string {
  const file = basename(target);
  const extension = extname(file);
  return extension ? file.slice(0, -extension.length) : file;
}

export function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

export function randomULID(): string {
  const chars = new Array<string>(26);
  let now = Date.now();
  for (let i = 9; i >= 0; i--) {
    chars[i] = CROCKFORD[now & 31]!;
    now = Math.floor(now / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(10));
  for (let i = 0; i < 16; i++) {
    const bit = i * 5;
    const byte = bit >> 3;
    const shift = bit & 7;
    chars[10 + i] = CROCKFORD[((rand[byte]! >> shift) | ((rand[byte + 1] ?? 0) << (8 - shift))) & 31]!;
  }
  return chars.join("");
}
