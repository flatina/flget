import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  bootstrapRoot,
  cliPath,
  commitBucketManifest,
  createWorkspaceManager,
  createDemoManifest,
  testsRoot,
  runCli,
  runGit,
  runProcess,
  writeJson,
} from "./helpers";

const { makeWorkspace, cleanupWorkspaces } = createWorkspaceManager();

afterEach(async () => {
  await cleanupWorkspaces();
});

describe("scoop e2e", () => {
  test("local scoop bucket install, update, repair, and remove flow works end-to-end", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-repo");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });

    const assets = new Map<string, string>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const key = url.pathname.replace(/^\/+/, "");
        const body = assets.get(key);
        if (!body) {
          return new Response("not found", { status: 404 });
        }
        return new Response(body, {
          headers: {
            "content-type": "application/octet-stream",
          },
        });
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const v1 = createDemoManifest(baseUrl, "1.0.0");
      for (const [name, body] of Object.entries(v1.assets)) {
        assets.set(name, body);
      }

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await commitBucketManifest(bucketRepo, v1.manifest, "init v1");

      await bootstrapRoot(root);
      await runCli(["bucket", "add", "local", bucketRepo], root);

      const install = await runCli(["install", "scoop:local/demo"], root);
      expect(install.stdout).toContain("Installed demo@1.0.0");
      expect(install.stdout).toContain("demo 1.0.0");

      const listJson = await runCli(["list", "--json"], root);
      const packages = JSON.parse(listJson.stdout) as Array<{ id: string; sourceType: string; resolvedVersion: string }>;
      expect(packages).toHaveLength(1);
      expect(packages[0]).toMatchObject({
        id: "demo",
        sourceType: "scoop",
        resolvedVersion: "1.0.0",
      });

      const infoV1 = JSON.parse((await runCli(["info", "demo"], root)).stdout) as {
        envSet?: Record<string, string>;
        bin: Array<{ name: string; target: string }>;
        interactiveEntries?: Array<{ name: string; target: string }>;
        daemonEntries?: unknown[];
        resolvedVersion: string;
      };
      expect(infoV1.resolvedVersion).toBe("1.0.0");
      expect(infoV1.envSet).toEqual({ DEMO_MODE: "enabled" });
      expect(infoV1.bin[0]).toMatchObject({ name: "demo", target: "demo-v1.cmd" });
      expect(infoV1.interactiveEntries?.[0]).toMatchObject({ name: "demo", target: "demo-v1.cmd" });
      expect(infoV1.daemonEntries).toEqual([]);

      const currentDir = join(root, "scoop", "demo", "current");
      await Bun.write(join(currentDir, "config.txt"), "user-data");

      const v2 = createDemoManifest(baseUrl, "2.0.0");
      for (const [name, body] of Object.entries(v2.assets)) {
        assets.set(name, body);
      }
      await commitBucketManifest(bucketRepo, v2.manifest, "update v2");

      const bucketUpdate = await runCli(["bucket", "update", "local"], root);
      expect(bucketUpdate.stdout).toContain("Synced bucket local");

      const update = await runCli(["update", "demo"], root);
      expect(update.stdout).toContain("Updated demo: 1.0.0 -> 2.0.0");

      const infoV2 = JSON.parse((await runCli(["info", "demo"], root)).stdout) as {
        envSet?: Record<string, string>;
        bin: Array<{ name: string; target: string }>;
        resolvedVersion: string;
      };
      expect(infoV2.resolvedVersion).toBe("2.0.0");
      expect(infoV2.envSet).toEqual({ DEMO_MODE: "updated" });
      expect(infoV2.bin[0]).toMatchObject({ name: "demo", target: "demo-v2.cmd" });

      const updatedFile = await readFile(join(currentDir, "demo-v2.cmd"), "utf8");
      expect(updatedFile).toContain("demo-v2");
      expect(await readFile(join(currentDir, "config.txt"), "utf8")).toBe("user-data");

      const previousDir = join(root, "scoop", "demo", "1.0.0");
      expect(await Bun.file(join(previousDir, "demo-v1.cmd")).exists()).toBe(true);

      const repair = await runCli(["repair"], root);
      expect(repair.stdout).toContain("No incomplete transactions.");

      const envSetCache = await readFile(join(root, "tmp", "cache-env-sets.txt"), "utf8");
      expect(envSetCache).toContain("DEMO_MODE=updated");

      const remove = await runCli(["remove", "demo"], root);
      expect(remove.stdout).toContain("Removed demo");

      const listAfterRemove = await runCli(["list"], root);
      expect(listAfterRemove.stdout).toContain("No packages installed.");
      expect(await Bun.file(join(root, "shims", "demo.cmd")).exists()).toBe(false);
      expect(await Bun.file(join(root, "scoop", "demo", "flget.meta.json")).exists()).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("scoop install honors --no-hash", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-bad-hash");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });

    const assets = new Map<string, string>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const key = url.pathname.replace(/^\/+/, "");
        const body = assets.get(key);
        if (!body) {
          return new Response("not found", { status: 404 });
        }
        return new Response(body, {
          headers: {
            "content-type": "application/octet-stream",
          },
        });
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const badManifest = createDemoManifest(baseUrl, "1.0.0", "0".repeat(64));
      for (const [name, body] of Object.entries(badManifest.assets)) {
        assets.set(name, body);
      }

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await commitBucketManifest(bucketRepo, badManifest.manifest, "bad hash");

      await bootstrapRoot(root);
      await runCli(["bucket", "add", "bad", bucketRepo], root);

      const failed = await runProcess([process.execPath, cliPath, "install", "scoop:bad/demo"], root);
      expect(failed.exitCode).toBe(1);
      expect(failed.stderr).toContain("Hash mismatch");

      const installed = await runCli(["install", "scoop:bad/demo", "--no-hash"], root);
      expect(installed.stdout).toContain("Installed demo@1.0.0");
      expect(installed.stderr).toContain("Skipped hash verification");
    } finally {
      server.stop(true);
    }
  });

  test("scoop hooks receive original $fname and --no-scripts skips hook execution", async () => {
    const workspace = await makeWorkspace();
    const rootWithScripts = join(workspace.dir, "root-with-scripts");
    const rootNoScripts = join(workspace.dir, "root-no-scripts");
    const bucketRepo = join(workspace.dir, "bucket-hooks");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });

    const assets = new Map<string, string>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const key = url.pathname.replace(/^\/+/, "");
        const body = assets.get(key);
        if (!body) {
          return new Response("not found", { status: 404 });
        }
        return new Response(body, {
          headers: {
            "content-type": "application/octet-stream",
          },
        });
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const hooked = createDemoManifest(baseUrl, "1.0.0");
      const hookedManifest = {
        ...hooked.manifest,
        pre_install: [
          "Set-Content -Path (Join-Path $dir 'hook.txt') -Value $fname",
        ],
        post_install: [
          "Set-Content -Path (Join-Path $dir 'persist-path.txt') -Value $persist_dir",
        ],
      };
      for (const [name, body] of Object.entries(hooked.assets)) {
        assets.set(name, body);
      }

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await commitBucketManifest(bucketRepo, hookedManifest, "hooked manifest");

      await bootstrapRoot(rootWithScripts);
      await runCli(["bucket", "add", "hooks", bucketRepo], rootWithScripts);
      await runCli(["install", "scoop:hooks/demo"], rootWithScripts);
      expect(await readFile(join(rootWithScripts, "scoop", "demo", "current", "hook.txt"), "utf8")).toContain("demo-v1.cmd");
      expect((await readFile(join(rootWithScripts, "scoop", "demo", "current", "persist-path.txt"), "utf8")).trim())
        .toBe(join(rootWithScripts, "scoop", "demo", "current"));

      await bootstrapRoot(rootNoScripts);
      await runCli(["bucket", "add", "hooks", bucketRepo], rootNoScripts);
      await runCli(["install", "scoop:hooks/demo", "--no-scripts"], rootNoScripts);
      expect(await Bun.file(join(rootNoScripts, "scoop", "demo", "current", "hook.txt")).exists()).toBe(false);
      expect(await Bun.file(join(rootNoScripts, "scoop", "demo", "current", "persist-path.txt")).exists()).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("scoop search matches manifest names first and falls back to bin names", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-search");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });

    await runGit(workspace.dir, ["init", bucketRepo]);
    await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
    await runGit(bucketRepo, ["config", "user.name", "E2E"]);

    await writeJson(join(bucketRepo, "bucket", "demo-name.json"), {
      version: "1.0.0",
      url: "https://example.invalid/demo-name.exe",
      bin: [["demo-name.exe", "demo-name"]],
    });
    await writeJson(join(bucketRepo, "bucket", "alpha.json"), {
      version: "2.0.0",
      url: "https://example.invalid/alpha.exe",
      bin: [["tool-findme.exe", "findme"]],
    });
    await runGit(bucketRepo, ["add", "."]);
    await runGit(bucketRepo, ["commit", "-m", "add search manifests"]);

    await bootstrapRoot(root);
    await runCli(["bucket", "add", "local", bucketRepo], root);

    const byName = await runCli(["search", "demo"], root);
    expect(byName.stdout).toContain("scoop:local/demo-name (1.0.0)");
    expect(byName.stdout).not.toContain("findme");

    const byBin = await runCli(["search", "findme"], root);
    expect(byBin.stdout).toContain("scoop:local/alpha (2.0.0) -> findme");
  });

  test("fund uses known sponsor links from scoop manifest homepage", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-fund");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });

    const assets = new Map<string, string>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const key = new URL(request.url).pathname.replace(/^\/+/, "");
        const body = assets.get(key);
        return body
          ? new Response(body, { headers: { "content-type": "application/octet-stream" } })
          : new Response("not found", { status: 404 });
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const manifest = createDemoManifest(baseUrl, "1.0.0");
      for (const [name, body] of Object.entries(manifest.assets)) {
        assets.set(name, body);
      }

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        ...manifest.manifest,
        homepage: "https://ko-fi.com/mockscoop",
        description: "Support scoop demo",
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "add funded manifest"]);

      await bootstrapRoot(root);
      await runCli(["bucket", "add", "local", bucketRepo], root);
      await runCli(["install", "scoop:local/demo"], root);

      const fund = await runCli(["fund", "demo"], root);
      expect(fund.stdout).toContain("demo");
      expect(fund.stdout).toContain("https://ko-fi.com/mockscoop");
      expect(fund.stdout).toContain("Support scoop demo");
    } finally {
      server.stop(true);
    }
  });

  test("scoop shortcuts are preserved as interactive launch metadata", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-shortcuts");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });

    const assets = new Map<string, string>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const key = new URL(request.url).pathname.replace(/^\/+/, "");
        const body = assets.get(key);
        return body
          ? new Response(body, { headers: { "content-type": "application/octet-stream" } })
          : new Response("not found", { status: 404 });
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      const manifest = createDemoManifest(baseUrl, "1.0.0");
      for (const [name, body] of Object.entries(manifest.assets)) {
        assets.set(name, body);
      }

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        ...manifest.manifest,
        shortcuts: [
          ["demo-v1.cmd", "Demo App", "--tray"],
        ],
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "add shortcut manifest"]);

      await bootstrapRoot(root);
      await runCli(["bucket", "add", "local", bucketRepo], root);
      await runCli(["install", "scoop:local/demo"], root);

      const info = JSON.parse((await runCli(["info", "demo"], root)).stdout) as {
        interactiveEntries?: Array<{ name: string; target: string; args?: string }>;
      };
      expect(info.interactiveEntries).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "demo", target: "demo-v1.cmd" }),
        expect.objectContaining({ name: "Demo App", target: "demo-v1.cmd", args: "--tray" }),
      ]));
    } finally {
      server.stop(true);
    }
  });
});
