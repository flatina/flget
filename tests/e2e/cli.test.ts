import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  bootstrapRoot,
  cliPath,
  createMockGitHubServer,
  createTarGz,
  createMockNpmRegistryServer,
  createNpmTarball,
  createWorkspaceManager,
  fixtureRoot,
  runCli,
  runGit,
  runProcess,
  writeJson,
} from "./helpers";

const { makeWorkspace, cleanupWorkspaces } = createWorkspaceManager();

afterEach(async () => {
  await cleanupWorkspaces();
});

describe("flget CLI surface", () => {
  test("--version prints version", async () => {
    const result = await runProcess([process.execPath, cliPath, "--version"], fixtureRoot);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("flget 0.1.1");
  });

  test("-v prints version", async () => {
    const result = await runProcess([process.execPath, cliPath, "-v"], fixtureRoot);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("flget 0.1.1");
  });

  test("--help prints expanded help", async () => {
    const result = await runProcess([process.execPath, cliPath, "--help"], fixtureRoot);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("Aliases:");
    expect(result.stdout).toContain("Sources:");
    expect(result.stdout).toContain("Global options:");
  });

  test("invalid install flags are rejected before dispatch", async () => {
    const invalidArch = await runProcess([process.execPath, cliPath, "install", "npm:demo", "--arch", "weird"], fixtureRoot);
    expect(invalidArch.exitCode).toBe(1);
    expect(invalidArch.stderr).toContain("Invalid --arch: weird");

    const invalidSource = await runProcess([process.execPath, cliPath, "install", "demo", "--source", "nope"], fixtureRoot);
    expect(invalidSource.exitCode).toBe(1);
    expect(invalidSource.stderr).toContain("Invalid --source: nope");
  });

  test("command aliases work", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");

    await bootstrapRoot(root);

    const list = await runCli(["ls"], root);
    expect(list.stdout).toContain("No packages installed.");

    const update = await runProcess([process.execPath, cliPath, "u", "--no-self"], root);
    expect(update.exitCode).toBe(1);
    expect(update.stderr).toContain("Usage: flget update [<package>] [--all] [--no-self]");

    const remove = await runProcess([process.execPath, cliPath, "rm"], root);
    expect(remove.exitCode).toBe(1);
    expect(remove.stderr).toContain("Usage: flget remove <package>");
  });

  test("unknown command still reports unknown command inside a bootstrapped root", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");

    await bootstrapRoot(root);

    const result = await runProcess([process.execPath, cliPath, "nosuchcmd"], root);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command: nosuchcmd");
  });

  test("env bootstraps a fresh root and list works", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");

    const env = await bootstrapRoot(root);
    expect(env.stdout).toContain("Regenerated env caches.");

    const list = await runCli(["list"], root);
    expect(list.stdout).toContain("No packages installed.");
    expect(await Bun.file(join(root, "flget.root.toml")).exists()).toBe(true);
    expect(await Bun.file(join(root, "activate.bat")).exists()).toBe(false);
    expect(await Bun.file(join(root, "REGISTER_PATH.bat")).exists()).toBe(false);
    expect(await Bun.file(join(root, "shims", "flget.cmd")).exists()).toBe(true);
    expect(await Bun.file(join(root, "shims", "flget.ps1")).exists()).toBe(true);
    expect(await Bun.file(join(root, "shims", "bun.cmd")).exists()).toBe(true);
    expect(await Bun.file(join(root, "shims", "bun.ps1")).exists()).toBe(true);

    const activatePs1 = await Bun.file(join(root, "activate.ps1")).text();
    expect(activatePs1).toContain('Join-Path $PSScriptRoot "bun.exe"');
    expect(activatePs1).toContain('Get-Command bun -ErrorAction SilentlyContinue');
    expect(activatePs1).toContain("Test-BucketBootstrapNeeded");
    expect(activatePs1).toContain('Join-Path $PSScriptRoot "buckets"');
    expect(activatePs1).toContain('shims\\bun.cmd');

    const updatePs1 = await Bun.file(join(root, "update.ps1")).text();
    expect(updatePs1).toContain('Downloading latest update script');
    expect(updatePs1).toContain('releases/latest');
    expect(updatePs1).toContain('flget-win-x64.zip');
    expect(updatePs1).toContain("Invoke-BucketBootstrapIfNeeded");
    expect(updatePs1).toContain('flget updated at');

    const registerPs1 = await Bun.file(join(root, "REGISTER_PATH.ps1")).text();
    expect(registerPs1).toContain("Registered flget from");
  });

  test("bare update launches self-update via update.ps1", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");

    try {
      await bootstrapRoot(root);
      await writeFile(join(root, "update.ps1"), `#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$BaseUrl = "",
  [string]$RootPath,
  [switch]$ApplyDownloadedUpdate
)
$targetRoot = if ($RootPath) { $RootPath } else { $PSScriptRoot }
$marker = Join-Path $targetRoot "self-update-marker.txt"
Set-Content -LiteralPath $marker -Encoding ASCII -Value "updated"
Write-Host "mock self update"
`, "utf8");

      const env = {
        FLGET_SELF_UPDATE_SYNC: "1",
      };
      const result = await runProcess([process.execPath, cliPath, "update"], root, env);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("mock self update");
      expect(await Bun.file(join(root, "self-update-marker.txt")).text()).toContain("updated");
    } finally {
    }
  });

  test("bucket and registry usage errors are reported", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");

    await bootstrapRoot(root);

    const bucket = await runProcess([process.execPath, cliPath, "bucket"], root);
    expect(bucket.exitCode).toBe(1);
    expect(bucket.stderr).toContain("Usage: flget bucket <add|remove|list|update> ...");

    const registry = await runProcess([process.execPath, cliPath, "registry"], root);
    expect(registry.exitCode).toBe(1);
    expect(registry.stderr).toContain("Usage: flget registry <list|add|remove|update> ...");

    const roots = await runProcess([process.execPath, cliPath, "root"], root);
    expect(roots.exitCode).toBe(1);
    expect(roots.stderr).toContain("Usage: flget root <add|remove|list|first|last> ...");

    const skills = await runProcess([process.execPath, cliPath, "skills"], root);
    expect(skills.exitCode).toBe(1);
    expect(skills.stderr).toContain("Usage: flget skills <find|install|list|info|update|remove> ...");

    const reset = await runProcess([process.execPath, cliPath, "reset"], root);
    expect(reset.exitCode).toBe(1);
    expect(reset.stderr).toContain("Usage: flget reset <package> [--source <source>]");
  });

  test("search --source scopes results the same way as a source-prefixed query", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-search-flag");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });

    try {
      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        version: "1.0.0",
        url: "https://example.test/demo.exe",
        hash: "a".repeat(64),
        bin: [["demo.exe", "demo"]],
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "add search manifest"]);

      await bootstrapRoot(root);
      await runCli(["bucket", "add", "local", bucketRepo], root);

      const flagged = await runCli(["search", "demo", "--source", "scoop"], root);
      const prefixed = await runCli(["search", "scoop:demo"], root);
      expect(flagged.stdout).toBe(prefixed.stdout);
      expect(flagged.stdout).toContain("scoop:local/demo");

      const conflicting = await runProcess([process.execPath, cliPath, "search", "scoop:demo", "--source", "npm"], root);
      expect(conflicting.exitCode).toBe(1);
      expect(conflicting.stderr).toContain("Use either a source-prefixed query or --source, not both.");
    } finally {
    }
  });

  test("root add/list/first/last/remove manage offline roots in config order", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const sourceA = join(workspace.dir, "source-a");
    const sourceB = join(workspace.dir, "source-b");

    await bootstrapRoot(root);
    await bootstrapRoot(sourceA);
    await bootstrapRoot(sourceB);

    await runCli(["root", "add", sourceA], root);
    await runCli(["root", "add", sourceB], root);

    const listed = await runCli(["root", "list"], root);
    expect(listed.stdout.trim().split(/\r?\n/)).toEqual([sourceA, sourceB]);

    await runCli(["root", "first", sourceB], root);
    const firstListed = await runCli(["root", "list"], root);
    expect(firstListed.stdout.trim().split(/\r?\n/)).toEqual([sourceB, sourceA]);

    await runCli(["root", "last", sourceB], root);
    const lastListed = await runCli(["root", "list"], root);
    expect(lastListed.stdout.trim().split(/\r?\n/)).toEqual([sourceA, sourceB]);

    await runCli(["root", "remove", sourceA], root);
    const removedListed = await runCli(["root", "list"], root);
    expect(removedListed.stdout.trim()).toBe(sourceB);
  });

  test("install accepts bare scoop query when it resolves to a single match", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-repo");
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
      assets.set("demo.exe", "@echo off\r\necho demo\r\n");

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        version: "1.0.0",
        url: `${baseUrl}/demo.exe`,
        bin: [["demo.exe", "demo"]],
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "add demo manifest"]);

      await bootstrapRoot(root);
      await runCli(["bucket", "add", "local", bucketRepo], root);

      const result = await runCli(["install", "demo", "--source", "scoop", "--no-hash"], root);
      expect(result.stdout).toContain("Installed demo@1.0.0");
    } finally {
      server.stop(true);
    }
  });

  test("install accepts source-prefixed partial scoop query when it resolves to a single match", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-repo");
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
      assets.set("demo.exe", "@echo off\r\necho demo\r\n");

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        version: "1.0.0",
        url: `${baseUrl}/demo.exe`,
        bin: [["demo.exe", "demo"]],
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "add demo manifest"]);

      await bootstrapRoot(root);
      await runCli(["bucket", "add", "local", bucketRepo], root);

      const result = await runCli(["install", "scoop:dem", "--no-hash"], root);
      expect(result.stdout).toContain("Installed demo@1.0.0");
    } finally {
      server.stop(true);
    }
  });

  test("install bare partial query requires search or explicit source", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-repo");
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
    const githubServer = createMockGitHubServer({
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {},
      searchRepositories: [],
      requiredAuthToken: undefined,
    });
    const npmServer = createMockNpmRegistryServer({
      packages: {},
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}`;
      assets.set("demo.exe", "@echo off\r\necho demo\r\n");

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        version: "1.0.0",
        url: `${baseUrl}/demo.exe`,
        bin: [["demo.exe", "demo"]],
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "add demo manifest"]);

      const env = {
        FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${githubServer.port}`,
        FLGET_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${npmServer.port}`,
      };
      await bootstrapRoot(root, env);
      await runCli(["bucket", "add", "local", bucketRepo], root, env);

      const result = await runProcess([process.execPath, cliPath, "install", "dem", "--no-hash"], root, env);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No exact installable source found for dem");
      expect(result.stderr).toContain("flget search dem");
    } finally {
      server.stop(true);
      githubServer.stop(true);
      npmServer.stop(true);
    }
  });

  test("install bare query errors non-interactively when multiple matches exist", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-repo");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });
    const assets = new Map<string, string>();
    const scoopServer = Bun.serve({
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
    const npmServer = createMockNpmRegistryServer({
      packages: {
        demo: {
          latest: "1.0.0",
          versions: {
            "1.0.0": await createNpmTarball("1.0.0", "npm-demo"),
          },
        },
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${scoopServer.port}`;
      assets.set("demo.exe", "@echo off\r\necho demo\r\n");

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        version: "1.0.0",
        url: `${baseUrl}/demo.exe`,
        bin: [["demo.exe", "demo"]],
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "add demo manifest"]);

      const env = {
        FLGET_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${npmServer.port}`,
      };
      await bootstrapRoot(root, env);
      await runCli(["bucket", "add", "local", bucketRepo], root, env);

      const result = await runProcess([process.execPath, cliPath, "install", "demo"], root, env);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Multiple matches found for demo");
    } finally {
      scoopServer.stop(true);
      npmServer.stop(true);
    }
  });

  test("reset can switch the active winner for a shared app id", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-repo");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });
    const assets = new Map<string, string>();
    const scoopServer = Bun.serve({
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
    const npmServer = createMockNpmRegistryServer({
      packages: {
        demo: {
          latest: "1.0.0",
          versions: {
            "1.0.0": await createTarGz({
              ["package/package.json"]: JSON.stringify({
                name: "demo",
                version: "1.0.0",
                bin: {
                  demo: "bin/demo.js",
                },
              }, null, 2),
              ["package/bin/demo.js"]: "#!/usr/bin/env bun\nconsole.log('npm-demo');\n",
            }),
          },
        },
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${scoopServer.port}`;
      assets.set("demo.exe", "@echo off\r\necho scoop-demo\r\n");

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        version: "1.0.0",
        url: `${baseUrl}/demo.exe`,
        bin: [["demo.exe", "demo"]],
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "add demo manifest"]);

      const env = {
        FLGET_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${npmServer.port}`,
      };
      await bootstrapRoot(root, env);
      await runCli(["bucket", "add", "local", bucketRepo], root, env);

      await runCli(["install", "scoop:local/demo", "--no-hash"], root, env);
      await runCli(["install", "npm:demo"], root, env);

      const npmShim = await readFile(join(root, "shims", "demo.cmd"), "utf8");
      expect(npmShim).toContain("\\npm\\demo\\current\\bin\\demo.js");

      const reset = await runCli(["reset", "demo", "--source", "scoop"], root, env);
      expect(reset.stdout).toContain("Reset demo to scoop");

      const scoopShim = await readFile(join(root, "shims", "demo.cmd"), "utf8");
      expect(scoopShim).toContain("\\scoop\\demo\\current\\demo.exe");

      const info = await runCli(["info", "demo"], root, env);
      expect(info.stdout).toContain('"sourceType": "scoop"');
    } finally {
      scoopServer.stop(true);
      npmServer.stop(true);
    }
  });

  test("force reinstall of one shared-id source preserves the other source metadata", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-repo");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });
    const assets = new Map<string, string>();
    const scoopServer = Bun.serve({
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
    const npmServer = createMockNpmRegistryServer({
      packages: {
        demo: {
          latest: "1.0.0",
          versions: {
            "1.0.0": await createTarGz({
              ["package/package.json"]: JSON.stringify({
                name: "demo",
                version: "1.0.0",
                bin: {
                  demo: "bin/demo.js",
                },
              }, null, 2),
              ["package/bin/demo.js"]: "#!/usr/bin/env bun\nconsole.log('npm-demo');\n",
            }),
          },
        },
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${scoopServer.port}`;
      assets.set("demo.exe", "@echo off\r\necho scoop-demo\r\n");

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        version: "1.0.0",
        url: `${baseUrl}/demo.exe`,
        bin: [["demo.exe", "demo"]],
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "add demo manifest"]);

      const env = {
        FLGET_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${npmServer.port}`,
      };
      await bootstrapRoot(root, env);
      await runCli(["bucket", "add", "local", bucketRepo], root, env);

      await runCli(["install", "scoop:local/demo", "--no-hash"], root, env);
      await runCli(["install", "npm:demo"], root, env);

      const forceInstall = await runCli(["install", "scoop:local/demo", "--force", "--no-hash"], root, env);
      expect(forceInstall.stdout).toContain("Installed demo@1.0.0");

      const reset = await runCli(["reset", "demo", "--source", "npm"], root, env);
      expect(reset.stdout).toContain("Reset demo to npm");

      const info = await runCli(["info", "demo"], root, env);
      expect(info.stdout).toContain('"sourceType": "npm"');
    } finally {
      scoopServer.stop(true);
      npmServer.stop(true);
    }
  });

  test("remove promotes the remaining shared-id source back to winner", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-repo");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });
    const assets = new Map<string, string>();
    const scoopServer = Bun.serve({
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
    const npmServer = createMockNpmRegistryServer({
      packages: {
        demo: {
          latest: "1.0.0",
          versions: {
            "1.0.0": await createTarGz({
              ["package/package.json"]: JSON.stringify({
                name: "demo",
                version: "1.0.0",
                bin: {
                  demo: "bin/demo.js",
                },
              }, null, 2),
              ["package/bin/demo.js"]: "#!/usr/bin/env bun\nconsole.log('npm-demo');\n",
            }),
          },
        },
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${scoopServer.port}`;
      assets.set("demo.exe", "@echo off\r\necho scoop-demo\r\n");

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        version: "1.0.0",
        url: `${baseUrl}/demo.exe`,
        bin: [["demo.exe", "demo"]],
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "add demo manifest"]);

      const env = {
        FLGET_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${npmServer.port}`,
      };
      await bootstrapRoot(root, env);
      await runCli(["bucket", "add", "local", bucketRepo], root, env);

      await runCli(["install", "scoop:local/demo", "--no-hash"], root, env);
      await runCli(["install", "npm:demo"], root, env);

      const remove = await runCli(["remove", "demo"], root, env);
      expect(remove.stdout).toContain("Removed demo");

      const info = await runCli(["info", "demo"], root, env);
      expect(info.stdout).toContain('"sourceType": "scoop"');

      const scoopShim = await readFile(join(root, "shims", "demo.cmd"), "utf8");
      expect(scoopShim).toContain("\\scoop\\demo\\current\\demo.exe");
    } finally {
      scoopServer.stop(true);
      npmServer.stop(true);
    }
  });

  test("update --all updates all shared-id installs and preserves the explicit winner", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const bucketRepo = join(workspace.dir, "bucket-repo");
    await mkdir(join(bucketRepo, "bucket"), { recursive: true });
    const assets = new Map<string, string>();
    const scoopServer = Bun.serve({
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
    const npmState: {
      packages: Record<string, {
        latest: string;
        versions: Record<string, ArrayBuffer>;
      }>;
    } = {
      packages: {
        demo: {
          latest: "1.0.0",
          versions: {
            "1.0.0": await createTarGz({
              ["package/package.json"]: JSON.stringify({
                name: "demo",
                version: "1.0.0",
                bin: {
                  demo: "bin/demo.js",
                },
              }, null, 2),
              ["package/bin/demo.js"]: "#!/usr/bin/env bun\nconsole.log('npm-demo-v1');\n",
            }),
          },
        },
      },
    };
    const npmServer = createMockNpmRegistryServer(npmState);

    try {
      const baseUrl = `http://127.0.0.1:${scoopServer.port}`;
      assets.set("demo-v1.cmd", "@echo off\r\necho scoop-demo-v1\r\n");
      assets.set("demo-v2.cmd", "@echo off\r\necho scoop-demo-v2\r\n");

      await runGit(workspace.dir, ["init", bucketRepo]);
      await runGit(bucketRepo, ["config", "user.email", "e2e@example.com"]);
      await runGit(bucketRepo, ["config", "user.name", "E2E"]);
      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        version: "1.0.0",
        url: `${baseUrl}/demo-v1.cmd`,
        bin: [["demo-v1.cmd", "demo"]],
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "add demo v1"]);

      const env = {
        FLGET_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${npmServer.port}`,
      };
      await bootstrapRoot(root, env);
      await runCli(["bucket", "add", "local", bucketRepo], root, env);

      await runCli(["install", "scoop:local/demo", "--no-hash"], root, env);
      await runCli(["install", "npm:demo"], root, env);
      await runCli(["reset", "demo", "--source", "scoop"], root, env);

      npmState.packages.demo.latest = "2.0.0";
      npmState.packages.demo.versions["2.0.0"] = await createTarGz({
        ["package/package.json"]: JSON.stringify({
          name: "demo",
          version: "2.0.0",
          bin: {
            demo: "bin/demo.js",
          },
        }, null, 2),
        ["package/bin/demo.js"]: "#!/usr/bin/env bun\nconsole.log('npm-demo-v2');\n",
      });

      await writeJson(join(bucketRepo, "bucket", "demo.json"), {
        version: "2.0.0",
        url: `${baseUrl}/demo-v2.cmd`,
        bin: [["demo-v2.cmd", "demo"]],
      });
      await runGit(bucketRepo, ["add", "."]);
      await runGit(bucketRepo, ["commit", "-m", "update demo v2"]);
      await runCli(["bucket", "update", "local"], root, env);

      const update = await runCli(["update", "--all", "--no-self", "--no-hash"], root, env);
      expect(update.stdout).toContain("Updated demo: 1.0.0 -> 2.0.0");

      const info = await runCli(["info", "demo"], root, env);
      expect(info.stdout).toContain('"sourceType": "scoop"');
      expect(await readFile(join(root, "scoop", "demo", "current", "demo-v2.cmd"), "utf8")).toContain("scoop-demo-v2");
      expect(await readFile(join(root, "npm", "demo", "current", "package.json"), "utf8")).toContain('"version": "2.0.0"');

      const scoopShim = await readFile(join(root, "shims", "demo.cmd"), "utf8");
      expect(scoopShim).toContain("\\scoop\\demo\\current\\demo-v2.cmd");
    } finally {
      scoopServer.stop(true);
      npmServer.stop(true);
    }
  });
});
