import { basename, extname } from "node:path";
import type { ShimDef } from "../core/types";

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
  const extension = extname(target).toLowerCase();
  switch (extension) {
    case ".exe":
    case ".com":
      return "exe";
    case ".cmd":
    case ".bat":
      return "cmd";
    case ".ps1":
      return "ps1";
    case ".jar":
      return "jar";
    case ".py":
      return "py";
    case ".js":
    case ".cjs":
    case ".mjs":
      return "js";
    case ".ts":
    case ".cts":
    case ".mts":
      return "ts";
    default:
      return "other";
  }
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
