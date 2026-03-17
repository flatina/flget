import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyExtractDir } from "./extract";

describe("applyExtractDir", () => {
  test("treats a flattened extract_dir root as already satisfied", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-extract-"));
    await writeFile(join(root, "node.exe"), "node");
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(join(root, "bin", "npm.cmd"), "npm");

    await applyExtractDir(root, "node-v25.8.1-win-x64", "node-v25.8.1-win-x64");

    expect(await Bun.file(join(root, "node.exe")).exists()).toBe(true);
    expect(await Bun.file(join(root, "bin", "npm.cmd")).exists()).toBe(true);
  });

  test("strips a flattened root prefix before applying nested extract_dir", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-extract-"));
    await mkdir(join(root, "pkg", "bin"), { recursive: true });
    await writeFile(join(root, "pkg", "bin", "tool.exe"), "tool");

    await applyExtractDir(root, "archive-root/pkg", "archive-root");

    expect(await Bun.file(join(root, "bin", "tool.exe")).exists()).toBe(true);
    expect(await Bun.file(join(root, "pkg")).exists()).toBe(false);
  });
});
