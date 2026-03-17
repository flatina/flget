import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createShims } from "./shim";
import { detectShimType } from "../utils/strings";

describe("bun fallback shims", () => {
  test("js-family shims try root bun, then parent bun, then PATH", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-shims-"));

    await createShims(root, "npm", "demo", [{
      name: "demo",
      target: "bin/demo.cjs",
      type: detectShimType("bin/demo.cjs"),
    }]);

    const cmd = await readFile(join(root, "shims", "demo.cmd"), "utf8");
    expect(cmd).toContain("%SHIMDIR%\\..\\bun.exe");
    expect(cmd).toContain("%SHIMDIR%\\..\\..\\bun.exe");
    expect(cmd).toContain("demo.cjs");

    const ps1 = await readFile(join(root, "shims", "demo.ps1"), "utf8");
    expect(ps1).toContain('Join-Path $PSScriptRoot "..\\bun.exe"');
    expect(ps1).toContain('Join-Path $PSScriptRoot "..\\..\\bun.exe"');
    expect(ps1).toContain("demo.cjs");
  });

  test("runner-aware shims can dispatch through bash", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-shims-"));

    await createShims(root, "skill-github", "demo-skill", [{
      name: "demo-shell",
      target: "scripts/demo.sh",
      type: detectShimType("scripts/demo.sh"),
      runner: "bash",
    }]);

    const cmd = await readFile(join(root, "shims", "demo-shell.cmd"), "utf8");
    expect(cmd).toContain('bash "%SHIMDIR%\\..\\agents\\skills\\demo-skill\\current\\scripts\\demo.sh" %*');

    const ps1 = await readFile(join(root, "shims", "demo-shell.ps1"), "utf8");
    expect(ps1).toContain("& bash $target @args");
  });

  test("cmd-backed shims run cmd targets directly from PowerShell wrappers", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-shims-"));

    await createShims(root, "github-release", "demo-cmd", [{
      name: "demo-cmd",
      target: "bin/demo.cmd",
      type: "cmd",
    }]);

    const ps1 = await readFile(join(root, "shims", "demo-cmd.ps1"), "utf8");
    expect(ps1).toContain("& $target @args");
    expect(ps1).not.toContain("cmd /c");
  });
});
