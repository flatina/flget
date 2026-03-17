import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPackageMeta } from "./metadata";
import { getPackageBaseRelativePath } from "./package-layout";
import { ensureRootInitialized, ensureRootScripts } from "./root";

describe("ensureRootScripts", () => {
  test("migrates legacy js-family bin metadata and regenerates shims", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-root-scripts-"));
    await ensureRootInitialized(root);

    const metaPath = join(root, getPackageBaseRelativePath("npm", "prettier"), "flget.meta.json");
    await mkdir(join(root, getPackageBaseRelativePath("npm", "prettier")), { recursive: true });
    await writeFile(metaPath, `${JSON.stringify({
      displayName: "prettier",
      sourceRef: "npm:prettier",
      resolvedVersion: "3.8.1",
      resolvedRef: "3.8.1",
      portability: "portable",
      runtime: "bun-native",
      bin: [{
        name: "prettier",
        target: "./bin/prettier.cjs",
        type: "other",
      }],
      persist: [],
      warnings: [],
      notes: null,
    }, null, 2)}\n`, "utf8");

    await writeFile(join(root, "shims", "prettier.cmd"), "@echo off\r\nREM stale shim\r\n", "utf8");
    await writeFile(join(root, "shims", "prettier.ps1"), "Write-Host 'stale shim'\n", "utf8");

    await ensureRootScripts(root);

    const meta = await loadPackageMeta(root, "prettier");
    expect(meta?.bin[0]?.type).toBe("js");

    const storedMeta = JSON.parse(await readFile(metaPath, "utf8")) as {
      bin: Array<{ type: string }>;
    };
    expect(storedMeta.bin[0]?.type).toBe("js");

    const cmd = await readFile(join(root, "shims", "prettier.cmd"), "utf8");
    expect(cmd).not.toContain("stale shim");
    expect(cmd).toContain("prettier.cjs");

    const ps1 = await readFile(join(root, "shims", "prettier.ps1"), "utf8");
    expect(ps1).not.toContain("stale shim");
    expect(ps1).toContain("prettier.cjs");

    const flgetCmd = await readFile(join(root, "shims", "flget.cmd"), "utf8");
    expect(flgetCmd).toContain("%SHIMDIR%\\..\\flget.js");

    const bunCmd = await readFile(join(root, "shims", "bun.cmd"), "utf8");
    expect(bunCmd).toContain("%SHIMDIR%\\..\\bun.exe");

    const bunPs1 = await readFile(join(root, "shims", "bun.ps1"), "utf8");
    expect(bunPs1).toContain('Join-Path $PSScriptRoot "..\\bun.exe"');
  });
});
