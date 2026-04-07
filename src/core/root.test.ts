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

    // bun shims should NOT exist when bun.exe is absent (external bun mode)
    expect(await Bun.file(join(root, "shims", "bun.cmd")).exists()).toBe(false);
    expect(await Bun.file(join(root, "shims", "bun.ps1")).exists()).toBe(false);
  });

  test("cleans up stale bun shims when switching from embedded to external mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-bun-mode-"));
    await ensureRootInitialized(root);

    // Simulate embedded mode: create bun.exe and bun shims
    await writeFile(join(root, "bun.exe"), "fake-bun");
    await ensureRootScripts(root);
    expect(await Bun.file(join(root, "shims", "bun.cmd")).exists()).toBe(true);
    expect(await Bun.file(join(root, "shims", "bun.ps1")).exists()).toBe(true);

    // Switch to external mode: remove bun.exe, regenerate
    const { unlink } = await import("node:fs/promises");
    await unlink(join(root, "bun.exe"));
    await ensureRootScripts(root);

    // bun shims should be removed
    expect(await Bun.file(join(root, "shims", "bun.cmd")).exists()).toBe(false);
    expect(await Bun.file(join(root, "shims", "bun.ps1")).exists()).toBe(false);

    // flget shims should still exist
    expect(await Bun.file(join(root, "shims", "flget.cmd")).exists()).toBe(true);
    expect(await Bun.file(join(root, "shims", "flget.ps1")).exists()).toBe(true);
  });

  test("creates bun shims when bun.exe is present (embedded mode)", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-bun-embedded-"));
    await ensureRootInitialized(root);

    await writeFile(join(root, "bun.exe"), "fake-bun");
    await ensureRootScripts(root);

    const bunCmd = await readFile(join(root, "shims", "bun.cmd"), "utf8");
    expect(bunCmd).toContain("%SHIMDIR%\\..\\bun.exe");

    const bunPs1 = await readFile(join(root, "shims", "bun.ps1"), "utf8");
    expect(bunPs1).toContain('Join-Path $PSScriptRoot "..\\bun.exe"');

    const flgetCmd = await readFile(join(root, "shims", "flget.cmd"), "utf8");
    expect(flgetCmd).toContain("%SHIMDIR%\\..\\flget.js");
  });

  test("creates bun shims when switching from external to embedded mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-bun-ext-to-emb-"));
    await ensureRootInitialized(root);

    // Start external: no bun.exe
    await ensureRootScripts(root);
    expect(await Bun.file(join(root, "shims", "bun.cmd")).exists()).toBe(false);

    // Switch to embedded: add bun.exe, regenerate
    await writeFile(join(root, "bun.exe"), "fake-bun");
    await ensureRootScripts(root);

    expect(await Bun.file(join(root, "shims", "bun.cmd")).exists()).toBe(true);
    expect(await Bun.file(join(root, "shims", "bun.ps1")).exists()).toBe(true);
  });
});
