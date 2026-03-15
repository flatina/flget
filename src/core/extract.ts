import { inflateRawSync } from "node:zlib";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { mkdir, readdir, stat } from "node:fs/promises";
import { copyPath, ensureDir, ensureRelativePathInsideRoot, moveContentsUp, pathExists, removePath, renameStrict } from "../utils/fs";
import { readRuntimeArrayBuffer, readRuntimeBytes, spawnProcess, writeRuntimeBytes } from "../utils/runtime";

function b2(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

function b4(data: Uint8Array, offset: number): number {
  return (data[offset]! | (data[offset + 1]! << 8) | (data[offset + 2]! << 16) | (data[offset + 3]! << 24)) >>> 0;
}

function parseZipEntries(data: Uint8Array): Array<{ filename: string; method: number; compressedSize: number; localHeaderOffset: number }> {
  let eocd = data.length - 22;
  for (; eocd >= 0; eocd -= 1) {
    if (b4(data, eocd) === 0x06054b50) {
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("Invalid ZIP archive: end of central directory not found");
  }

  const count = b2(data, eocd + 10);
  let offset = b4(data, eocd + 16);
  const entries: Array<{ filename: string; method: number; compressedSize: number; localHeaderOffset: number }> = [];

  for (let index = 0; index < count; index += 1) {
    if (b4(data, offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP archive: central directory entry missing");
    }
    const method = b2(data, offset + 10);
    const compressedSize = b4(data, offset + 20);
    const filenameLength = b2(data, offset + 28);
    const extraLength = b2(data, offset + 30);
    const commentLength = b2(data, offset + 32);
    const localHeaderOffset = b4(data, offset + 42);
    const filename = new TextDecoder("utf-8").decode(data.subarray(offset + 46, offset + 46 + filenameLength));
    entries.push({ filename, method, compressedSize, localHeaderOffset });
    offset += 46 + filenameLength + extraLength + commentLength;
  }

  return entries;
}

function getLocalFileOffset(data: Uint8Array, localHeaderOffset: number): number {
  if (b4(data, localHeaderOffset) !== 0x04034b50) {
    throw new Error("Invalid ZIP archive: local header missing");
  }
  return localHeaderOffset + 30 + b2(data, localHeaderOffset + 26) + b2(data, localHeaderOffset + 28);
}

async function extractZip(archivePath: string, targetDir: string): Promise<void> {
  const data = new Uint8Array(await readRuntimeArrayBuffer(archivePath));
  const entries = parseZipEntries(data);

  for (const entry of entries) {
    if (entry.filename.endsWith("/")) {
      continue;
    }

    const relativePath = ensureRelativePathInsideRoot(targetDir, entry.filename);
    const output = resolve(targetDir, relativePath);
    await ensureDir(dirname(output));

    const start = getLocalFileOffset(data, entry.localHeaderOffset);
    const compressed = data.subarray(start, start + entry.compressedSize);
    let uncompressed: Uint8Array;

    if (entry.method === 0) {
      uncompressed = compressed.slice();
    } else if (entry.method === 8) {
      uncompressed = inflateRawSync(compressed);
    } else {
      throw new Error(`Unsupported ZIP compression method: ${entry.method}`);
    }

    await writeRuntimeBytes(output, uncompressed);
  }
}

async function extractTarLike(archivePath: string, targetDir: string): Promise<void> {
  const bytes = await readRuntimeBytes(archivePath);
  const archive = new Bun.Archive(bytes);
  await archive.extract(targetDir);
}

async function extract7z(archivePath: string, targetDir: string): Promise<void> {
  const process = spawnProcess({
    cmd: ["7z", "x", "-y", `-o${targetDir}`, archivePath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(process.stderr).text();
    throw new Error(`7z extraction failed: ${stderr.trim() || "unknown error"}`);
  }
}

export function detectArchiveType(filePath: string): "zip" | "tar" | "7z" | "single" | "msi" {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".zip")) {
    return "zip";
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz") || lower.endsWith(".tar")) {
    return "tar";
  }
  if (lower.endsWith(".7z")) {
    return "7z";
  }
  if (lower.endsWith(".msi")) {
    return "msi";
  }
  return "single";
}

async function flattenSingleRootDirectory(targetDir: string): Promise<string | null> {
  const entries = await readdir(targetDir, { withFileTypes: true });
  const visible = entries.filter((entry) => !entry.name.startsWith("."));
  if (visible.length !== 1 || !visible[0]!.isDirectory()) {
    return null;
  }

  const flattenedRoot = visible[0]!.name;
  const innerDir = join(targetDir, flattenedRoot);
  const tempDir = join(targetDir, ".flget-flatten");
  await mkdir(tempDir);
  await moveContentsUp(innerDir, tempDir);
  await removePath(innerDir);
  await moveContentsUp(tempDir, targetDir);
  await removePath(tempDir);
  return flattenedRoot;
}

export async function extractInto(archivePath: string, targetDir: string): Promise<string | null> {
  const archiveType = detectArchiveType(archivePath);
  switch (archiveType) {
    case "zip":
      await extractZip(archivePath, targetDir);
      return flattenSingleRootDirectory(targetDir);
    case "tar":
      await extractTarLike(archivePath, targetDir);
      return flattenSingleRootDirectory(targetDir);
    case "7z":
      await extract7z(archivePath, targetDir);
      return flattenSingleRootDirectory(targetDir);
    case "msi":
      throw new Error("MSI packages are not supported as portable installs in v2");
    case "single":
      await ensureDir(targetDir);
      await copyPath(archivePath, join(targetDir, normalize(archivePath).split(/[\\/]/).pop()!));
      return null;
  }
}

export async function applyExtractDir(
  targetDir: string,
  extractDir: string,
  flattenedRootDir?: string | null,
): Promise<void> {
  const normalized = ensureRelativePathInsideRoot(targetDir, extractDir);
  let sourceDir = resolve(targetDir, normalized);
  if (!await pathExists(sourceDir) && flattenedRootDir) {
    const parts = normalized.split(/[\\/]+/).filter(Boolean);
    if (parts[0]?.toLowerCase() === flattenedRootDir.toLowerCase()) {
      if (parts.length === 1) {
        return;
      }
      sourceDir = resolve(targetDir, join(...parts.slice(1)));
    }
  }
  if (!await pathExists(sourceDir)) {
    throw new Error(`extract_dir not found: ${extractDir}`);
  }
  const sourceStat = await stat(sourceDir);
  if (!sourceStat.isDirectory()) {
    throw new Error(`extract_dir is not a directory: ${extractDir}`);
  }

  const tempDir = resolve(targetDir, ".flget-extract-dir");
  await removePath(tempDir);
  await ensureDir(tempDir);
  await moveContentsUp(sourceDir, tempDir);
  const entries = await readdir(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".flget-extract-dir") {
      continue;
    }
    await removePath(join(targetDir, entry.name));
  }
  await moveContentsUp(tempDir, targetDir);
  await removePath(tempDir);
}
