import { mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile, copyFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}

export async function removePath(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
}

export async function writeJson(target: string, value: unknown): Promise<void> {
  await ensureDir(dirname(target));
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson<T>(target: string): Promise<T> {
  const content = await readFile(target, "utf8");
  return JSON.parse(content) as T;
}

export async function writeText(target: string, value: string): Promise<void> {
  await ensureDir(dirname(target));
  await writeFile(target, value, "utf8");
}

export async function readText(target: string): Promise<string> {
  return readFile(target, "utf8");
}

export async function renameStrict(from: string, to: string): Promise<void> {
  await ensureDir(dirname(to));
  await rename(from, to);
}

export async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function copyPath(from: string, to: string): Promise<void> {
  const sourceStat = await stat(from);
  if (sourceStat.isDirectory()) {
    await ensureDir(to);
    const entries = await readdir(from, { withFileTypes: true });
    for (const entry of entries) {
      await copyPath(join(from, entry.name), join(to, entry.name));
    }
    return;
  }

  await ensureDir(dirname(to));
  await copyFile(from, to);
}

export function ensureRelativePathInsideRoot(root: string, candidate: string): string {
  const normalized = normalize(candidate).replace(/^([/\\])+/, "");
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(root, normalized);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes root: ${candidate}`);
  }
  return normalized;
}

export async function moveContentsUp(fromDir: string, toDir: string): Promise<void> {
  await ensureDir(toDir);
  const entries = await readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    await renameStrict(join(fromDir, entry.name), join(toDir, entry.name));
  }
}

export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function withFileLock<T>(lockTarget: string, fn: () => Promise<T>): Promise<T> {
  const lockFile = `${lockTarget}.lock`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      handle = await open(lockFile, "wx");
      break;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (!handle) {
    throw new Error(`Unable to acquire lock: ${lockFile}`);
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(lockFile).catch(() => {});
  }
}
