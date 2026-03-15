import { basename, extname } from "node:path";
import { createHash } from "node:crypto";
import type { RuntimeContext } from "./types";
import { ensureDir } from "../utils/fs";
import { writeRuntimeBytes } from "../utils/runtime";

export interface DownloadResult {
  path: string;
  filename: string;
  originalName: string;
}

export interface DownloadOptions {
  requestInit?: RequestInit;
  filenameHint?: string;
}

function sanitizeFilename(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url;
  const base = basename(withoutQuery) || "download";
  return base.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function splitStemAndExtension(filename: string): { stem: string; extension: string } {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".tar.gz")) {
    return {
      stem: filename.slice(0, -".tar.gz".length),
      extension: ".tar.gz",
    };
  }
  if (lower.endsWith(".tgz")) {
    return {
      stem: filename.slice(0, -".tgz".length),
      extension: ".tgz",
    };
  }
  const extension = extname(filename);
  return {
    stem: extension ? filename.slice(0, -extension.length) : filename,
    extension,
  };
}

export function buildDownloadStoreName(url: string, filenameHint?: string): string {
  const safe = filenameHint ? sanitizeFilename(filenameHint) : sanitizeFilename(url);
  const { stem, extension } = splitStemAndExtension(safe);
  const hash = createHash("sha1").update(`${url}::${filenameHint ?? ""}`).digest("hex").slice(0, 12);
  return extension ? `${stem}-${hash}${extension}` : `${stem}-${hash}`;
}

export async function downloadToStore(
  context: RuntimeContext,
  url: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  await ensureDir(context.dirs.downloads);
  const originalName = sanitizeFilename(options.filenameHint ?? url);
  const filename = buildDownloadStoreName(url, options.filenameHint);
  const target = `${context.dirs.downloads}/${filename}`;

  context.logger.info(`downloading ${url}`);
  const response = await fetch(url, options.requestInit);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} (${url})`);
  }

  const body = await response.bytes();
  await writeRuntimeBytes(target, body);
  return { path: target, filename, originalName };
}
