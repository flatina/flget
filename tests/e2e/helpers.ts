import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface MockGitHubState {
  releaseTag: "v1.0.0" | "v2.0.0";
  npmReleaseTag: "v1.0.0" | "v2.0.0";
  skillSha: string;
  releaseAssets: Record<string, string>;
  npmTarballs: Record<string, ArrayBuffer>;
  skillTarballs: Record<string, ArrayBuffer>;
  fundingFiles?: Record<string, string>;
  repoDescriptions?: Record<string, string | null>;
  searchRepositories?: Array<{
    owner: string;
    repo: string;
    description?: string | null;
  }>;
  requiredAuthToken?: string;
}

export interface MockNpmRegistryState {
  packages: Record<string, {
    latest: string;
    versions: Record<string, ArrayBuffer>;
  }>;
}

export const cliPath = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
export const fixtureRoot = fileURLToPath(new URL("..", import.meta.url));
const staticRootSource = fileURLToPath(new URL("../../github-pages/", import.meta.url));

async function copyStaticRootScripts(root: string): Promise<void> {
  const rootFiles = ["activate.ps1", "update.ps1", "REGISTER_PATH.ps1"];
  for (const name of rootFiles) {
    await copyFile(join(staticRootSource, name), join(root, name));
  }
}

export function createWorkspaceManager(): {
  makeWorkspace: () => Promise<{ dir: string }>;
  cleanupWorkspaces: () => Promise<void>;
} {
  const workspaces: Array<{ dir: string }> = [];

  return {
    async makeWorkspace(): Promise<{ dir: string }> {
      const dir = await mkdtemp(join(tmpdir(), "flget-e2e-"));
      const workspace = { dir };
      workspaces.push(workspace);
      return workspace;
    },
    async cleanupWorkspaces(): Promise<void> {
      while (workspaces.length > 0) {
        const workspace = workspaces.pop()!;
        await rm(workspace.dir, { recursive: true, force: true });
      }
    },
  };
}

function inheritedEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return {
    ...env,
    ...extra,
  };
}

export async function runProcess(cmd: string[], cwd?: string, env?: Record<string, string>): Promise<ProcessResult> {
  const options: {
    cmd: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdout: "pipe";
    stderr: "pipe";
  } = {
    cmd,
    stdout: "pipe",
    stderr: "pipe",
  };
  if (cwd) {
    options.cwd = cwd;
  }
  if (env) {
    options.env = inheritedEnv(env);
  }

  const proc = Bun.spawn(options);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

export async function runCli(args: string[], cwd?: string, env?: Record<string, string>): Promise<ProcessResult> {
  const result = await runProcess([process.execPath, cliPath, ...args], cwd, env);
  if (result.exitCode !== 0) {
    throw new Error(`CLI failed (${result.exitCode})\ncmd: ${args.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return result;
}

export async function bootstrapRoot(root: string, env?: Record<string, string>): Promise<ProcessResult> {
  await mkdir(root, { recursive: true });
  await copyStaticRootScripts(root);
  return runCli(["env"], root, env);
}

export async function runGit(cwd: string, args: string[]): Promise<void> {
  const result = await runProcess(["git", ...args], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function createTarGz(files: Record<string, string>): Promise<ArrayBuffer> {
  const archive = new Bun.Archive(
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [path, new TextEncoder().encode(content)]),
    ),
    { compress: "gzip" },
  );
  const bytes = await archive.bytes();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function createDemoManifest(baseUrl: string, version: "1.0.0" | "2.0.0", hashOverride?: string): {
  manifest: Record<string, unknown>;
  assets: Record<string, string>;
} {
  const assetName = version === "1.0.0" ? "demo-v1.cmd" : "demo-v2.cmd";
  const body = version === "1.0.0"
    ? "@echo off\r\necho demo-v1\r\n"
    : "@echo off\r\necho demo-v2\r\n";
  return {
    manifest: {
      version,
      url: `${baseUrl}/${assetName}`,
      hash: hashOverride ?? sha256(body),
      bin: [[assetName, "demo"]],
      persist: ["config.txt"],
      env_set: {
        DEMO_MODE: version === "1.0.0" ? "enabled" : "updated",
      },
      notes: `demo ${version}`,
    },
    assets: {
      [assetName]: body,
    },
  };
}

export async function commitBucketManifest(bucketRepo: string, manifest: unknown, message: string): Promise<void> {
  await writeJson(join(bucketRepo, "bucket", "demo.json"), manifest);
  await runGit(bucketRepo, ["add", "."]);
  await runGit(bucketRepo, ["commit", "-m", message]);
}

function createReleaseResponse(baseUrl: string, tag: string): object {
  const suffix = tag === "v1.0.0" ? "v1" : "v2";
  return {
    tag_name: tag,
    name: tag,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: "test-ghr-windows.cmd",
        browser_download_url: `${baseUrl}/assets/releases/test-ghr-${suffix}.cmd`,
        size: 24,
        content_type: "application/octet-stream",
      },
    ],
  };
}

export async function createSkillTarball(
  sha: string,
  label: string,
  layout: "skills" | "codex" = "skills",
): Promise<ArrayBuffer> {
  const baseDir = layout === "codex" ? ".codex/skills/demo-skill" : "skills/demo-skill";
  return createTarGz({
    [`${baseDir}/SKILL.md`]: `---
name: demo-skill
description: Skill ${label}
flget:
  shims:
    - name: demo-skill-cli
      target: scripts/demo-skill.ts
---

# Demo Skill

Skill ${label}
`,
    [`${baseDir}/scripts/demo-skill.ts`]: `console.log("${label}");\n`,
    ["docs/placeholder.txt"]: `mock skill repo ${sha}\n`,
  });
}

export async function createNpmTarball(
  version: "1.0.0" | "2.0.0",
  label: string,
  options?: {
    packageJson?: Record<string, unknown>;
    extraFiles?: Record<string, string>;
  },
): Promise<ArrayBuffer> {
  return createTarGz({
    ["package/package.json"]: JSON.stringify({
      name: "mock-npm-cli",
      version,
      bin: {
        "mock-npm": "bin/mock-npm.js",
      },
      ...options?.packageJson,
    }, null, 2),
    ["package/bin/mock-npm.js"]: `#!/usr/bin/env bun\nconsole.log("${label}");\n`,
    ["package/README.md"]: `# mock npm ${version}\n`,
    ...(options?.extraFiles ?? {}),
  });
}

export function createMockNpmRegistryServer(state: MockNpmRegistryState) {
  let server!: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request): Response {
      const url = new URL(request.url);
      const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const baseUrl = `http://127.0.0.1:${server.port}`;

      const packageState = state.packages[path];
      if (packageState) {
        return Response.json({
          name: path,
          "dist-tags": {
            latest: packageState.latest,
          },
          versions: Object.fromEntries(Object.keys(packageState.versions).map((version) => [
            version,
            {
              version,
              dist: {
                tarball: `${baseUrl}/tarballs/${encodeURIComponent(path)}/${encodeURIComponent(version)}.tgz`,
              },
            },
          ])),
        });
      }

      if (path === "-/v1/search") {
        const query = (url.searchParams.get("text") ?? "").toLowerCase();
        const size = Number(url.searchParams.get("size") ?? "10");
        const objects = Object.entries(state.packages)
          .filter(([name]) => name.toLowerCase().includes(query))
          .slice(0, size)
          .map(([name, packageState]) => ({
            package: {
              name,
              version: packageState.latest,
            },
          }));
        return Response.json({ objects });
      }

      const tarballMatch = path.match(/^tarballs\/(.+)\/([^/]+)\.tgz$/);
      if (tarballMatch) {
        const packageName = tarballMatch[1]!;
        const version = tarballMatch[2]!;
        const tarball = state.packages[packageName]?.versions[version];
        return tarball
          ? new Response(tarball, { headers: { "content-type": "application/gzip" } })
          : new Response("not found", { status: 404 });
      }

      return new Response("not found", { status: 404 });
    },
  });
  return server;
}

export function createMockGitHubServer(state: MockGitHubState) {
  let server!: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request): Response {
      const url = new URL(request.url);
      const path = url.pathname;
      const baseUrl = `http://127.0.0.1:${server.port}`;

      if (path === "/repos/mock/test-ghr/releases/latest") {
        return Response.json(createReleaseResponse(baseUrl, state.releaseTag));
      }

      if (path === "/repos/mock/test-ghr/releases/tags/v1.0.0") {
        return Response.json(createReleaseResponse(baseUrl, "v1.0.0"));
      }

      if (path === "/repos/mock/test-ghr/releases/tags/v2.0.0") {
        return Response.json(createReleaseResponse(baseUrl, "v2.0.0"));
      }

      if (path === "/repos/mock/test-npm/releases/latest") {
        return Response.json({
          tag_name: state.npmReleaseTag,
          name: state.npmReleaseTag,
          draft: false,
          prerelease: false,
          assets: [],
        });
      }

      if (path === "/search/repositories") {
        const query = (url.searchParams.get("q") ?? "").toLowerCase();
        const items = (state.searchRepositories ?? []).filter((entry) => {
          const fullName = `${entry.owner}/${entry.repo}`.toLowerCase();
          const description = (entry.description ?? "").toLowerCase();
          return fullName.includes(query) || description.includes(query);
        }).map((entry) => ({
          full_name: `${entry.owner}/${entry.repo}`,
          name: entry.repo,
          description: entry.description ?? null,
          owner: {
            login: entry.owner,
          },
        }));
        return Response.json({ items });
      }

      if (path.startsWith("/assets/releases/")) {
        const key = path.split("/").pop()!;
        const body = state.releaseAssets[key];
        return body
          ? new Response(body, { headers: { "content-type": "application/octet-stream" } })
          : new Response("not found", { status: 404 });
      }

      if (path === "/repos/mock/test-skill") {
        return Response.json({
          default_branch: "main",
          name: "test-skill",
          description: state.repoDescriptions?.["mock/test-skill"] ?? null,
        });
      }

      const repoMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)$/);
      if (repoMatch) {
        const owner = repoMatch[1]!;
        const repo = repoMatch[2]!;
        return Response.json({
          default_branch: "main",
          name: repo,
          description: state.repoDescriptions?.[`${owner}/${repo}`] ?? null,
        });
      }

      if (path === "/repos/mock/test-skill/commits/main") {
        return Response.json({ sha: state.skillSha });
      }

      const npmTarballMatch = path.match(/^\/repos\/mock\/test-npm\/tarball\/(.+)$/);
      if (npmTarballMatch) {
        if (state.requiredAuthToken && request.headers.get("authorization") !== `Bearer ${state.requiredAuthToken}`) {
          return new Response("unauthorized", { status: 401 });
        }
        const ref = decodeURIComponent(npmTarballMatch[1]!);
        const tarball = state.npmTarballs[ref];
        return tarball
          ? new Response(tarball, { headers: { "content-type": "application/gzip" } })
          : new Response("not found", { status: 404 });
      }

      const tarballMatch = path.match(/^\/repos\/mock\/test-skill\/tarball\/(.+)$/);
      if (tarballMatch) {
        if (state.requiredAuthToken && request.headers.get("authorization") !== `Bearer ${state.requiredAuthToken}`) {
          return new Response("unauthorized", { status: 401 });
        }
        const ref = decodeURIComponent(tarballMatch[1]!);
        const tarball = state.skillTarballs[ref];
        return tarball
          ? new Response(tarball, { headers: { "content-type": "application/gzip" } })
          : new Response("not found", { status: 404 });
      }

      const fundingMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/\.github\/FUNDING\.(yml|yaml)$/);
      if (fundingMatch) {
        const owner = fundingMatch[1]!;
        const repo = fundingMatch[2]!;
        const content = state.fundingFiles?.[`${owner}/${repo}`];
        if (!content) {
          return new Response("not found", { status: 404 });
        }
        return Response.json({
          type: "file",
          encoding: "base64",
          content: Buffer.from(content, "utf8").toString("base64"),
        });
      }

      return new Response("not found", { status: 404 });
    },
  });
  return server;
}
