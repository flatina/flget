import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readConfig, writeConfig } from "../../src/core/config";
import {
  bootstrapRoot,
  cliPath,
  createMockGitHubServer,
  createWorkspaceManager,
  fixtureRoot,
  runCli,
  runProcess,
  type MockGitHubState,
} from "./helpers";

const { makeWorkspace, cleanupWorkspaces } = createWorkspaceManager();

afterEach(async () => {
  await cleanupWorkspaces();
});

describe("github release e2e", () => {
  test("github release search lists repository matches", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {},
      searchRepositories: [
        { owner: "mock", repo: "test-ghr", description: "release search target" },
      ],
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      const result = await runCli(["search", "ghr:test-ghr"], root, env);
      expect(result.stdout).toContain("ghr:mock/test-ghr");
    } finally {
      server.stop(true);
    }
  });

  test("install query with --source ghr resolves to the matched repository ref", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {
        "test-ghr-v1.cmd": "@echo off\r\necho ghr-v1\r\n",
      },
      npmTarballs: {},
      skillTarballs: {},
      searchRepositories: [
        { owner: "mock", repo: "test-ghr", description: "release search target" },
      ],
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const install = await runCli(["install", "test-ghr", "--source", "ghr"], root, env);
      expect(install.stdout).toContain("Installed test-ghr@v1.0.0");

      const info = JSON.parse((await runCli(["info", "test-ghr"], root, env)).stdout) as {
        sourceRef: string;
        resolvedVersion: string;
      };
      expect(info.sourceRef).toBe("ghr:mock/test-ghr");
      expect(info.resolvedVersion).toBe("v1.0.0");
    } finally {
      server.stop(true);
    }
  });

  test("disabled ghr source rejects explicit search and install", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {
        "test-ghr-v1.cmd": "@echo off\r\necho ghr-v1\r\n",
      },
      npmTarballs: {},
      skillTarballs: {},
      searchRepositories: [
        { owner: "mock", repo: "test-ghr", description: "release search target" },
      ],
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      const config = await readConfig(root);
      config.sources.ghr = false;
      await writeConfig(root, config);

      const search = await runProcess([process.execPath, cliPath, "search", "ghr:test-ghr"], root, env);
      expect(search.exitCode).toBe(1);
      expect(search.stderr).toContain("Source disabled by config: ghr");

      const install = await runProcess([process.execPath, cliPath, "install", "test-ghr", "--source", "ghr"], root, env);
      expect(install.exitCode).toBe(1);
      expect(install.stderr).toContain("Source disabled by config: ghr");
    } finally {
      server.stop(true);
    }
  });

  test("update fails for installed packages whose source is disabled", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {
        "test-ghr-v1.cmd": "@echo off\r\necho ghr-v1\r\n",
        "test-ghr-v2.cmd": "@echo off\r\necho ghr-v2\r\n",
      },
      npmTarballs: {},
      skillTarballs: {},
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      await runCli(["install", "ghr:mock/test-ghr"], root, env);

      const config = await readConfig(root);
      config.sources.ghr = false;
      await writeConfig(root, config);

      state.releaseTag = "v2.0.0";
      const update = await runProcess([process.execPath, cliPath, "update", "test-ghr"], root, env);
      expect(update.exitCode).toBe(1);
      expect(update.stderr).toContain("Source disabled by config: ghr");
    } finally {
      server.stop(true);
    }
  });

  test("mock GitHub release install, update, and remove flow works end-to-end", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {
        "test-ghr-v1.cmd": "@echo off\r\necho ghr-v1\r\n",
        "test-ghr-v2.cmd": "@echo off\r\necho ghr-v2\r\n",
      },
      npmTarballs: {},
      skillTarballs: {},
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const install = await runCli(["install", "ghr:mock/test-ghr"], root, env);
      expect(install.stdout).toContain("Installed test-ghr@v1.0.0");

      const infoV1 = JSON.parse((await runCli(["info", "test-ghr"], root, env)).stdout) as {
        resolvedVersion: string;
        sourceType: string;
        bin: Array<{ name: string; target: string }>;
        runtime: string;
        interactiveEntries?: Array<{ name: string; target: string }>;
        daemonEntries?: unknown[];
      };
      expect(infoV1).toMatchObject({
        resolvedVersion: "v1.0.0",
        sourceType: "github-release",
        runtime: "standalone",
      });
      expect(infoV1.bin[0]).toMatchObject({ name: "test-ghr-windows", target: "test-ghr-windows.cmd" });
      expect(infoV1.interactiveEntries?.[0]).toMatchObject({ name: "test-ghr-windows", target: "test-ghr-windows.cmd" });
      expect(infoV1.daemonEntries).toEqual([]);
      expect(await readFile(join(root, "ghr", "test-ghr", "current", "test-ghr-windows.cmd"), "utf8")).toContain("ghr-v1");

      state.releaseTag = "v2.0.0";
      const update = await runCli(["update", "test-ghr"], root, env);
      expect(update.stdout).toContain("Updated test-ghr: v1.0.0 -> v2.0.0");

      const infoV2 = JSON.parse((await runCli(["info", "test-ghr"], root, env)).stdout) as {
        resolvedVersion: string;
      };
      expect(infoV2.resolvedVersion).toBe("v2.0.0");
      expect(await readFile(join(root, "ghr", "test-ghr", "current", "test-ghr-windows.cmd"), "utf8")).toContain("ghr-v2");
      expect(await Bun.file(join(root, "ghr", "test-ghr", "v1.0.0", "test-ghr-windows.cmd")).exists()).toBe(true);

      const remove = await runCli(["remove", "test-ghr"], root, env);
      expect(remove.stdout).toContain("Removed test-ghr");
      expect(await Bun.file(join(root, "ghr", "test-ghr", "flget.meta.json")).exists()).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("fund reads GitHub FUNDING.yml for installed release packages", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {
        "test-ghr-v1.cmd": "@echo off\r\necho ghr-v1\r\n",
      },
      npmTarballs: {},
      skillTarballs: {},
      fundingFiles: {
        "mock/test-ghr": "ko_fi: mockghr\n",
      },
      repoDescriptions: {
        "mock/test-ghr": "Support mock release",
      },
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      await runCli(["install", "ghr:mock/test-ghr"], root, env);

      const fund = await runCli(["fund", "test-ghr"], root, env);
      expect(fund.stdout).toContain("test-ghr");
      expect(fund.stdout).toContain("https://ko-fi.com/mockghr");
    } finally {
      server.stop(true);
    }
  });

  test("github release override can declare daemon entries", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {
        "test-ghr-v1.cmd": "@echo off\r\necho ghr-v1\r\n",
      },
      npmTarballs: {},
      skillTarballs: {},
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      await writeFile(
        join(root, "tmp", "registries", "local", "overrides", "github-release", "mock--test-ghr.json"),
        `${JSON.stringify({
          daemonEntries: [{
            name: "test-ghr-daemon",
            run: {
              target: "test-ghr-windows.cmd",
            },
            status: {
              target: "test-ghr-windows.cmd",
            },
            restartPolicy: "on-failure",
            dependsOn: ["network"],
            autoStart: true,
          }],
        }, null, 2)}\n`,
        "utf8",
      );

      await runCli(["install", "ghr:mock/test-ghr"], root, env);
      const info = JSON.parse((await runCli(["info", "test-ghr"], root, env)).stdout) as {
        daemonEntries?: Array<{
          name: string;
          run: { target: string };
          status?: { target: string };
          restartPolicy?: string;
          dependsOn?: string[];
          autoStart?: boolean;
        }>;
      };

      expect(info.daemonEntries?.[0]).toMatchObject({
        name: "test-ghr-daemon",
        run: { target: "test-ghr-windows.cmd" },
        status: { target: "test-ghr-windows.cmd" },
        restartPolicy: "on-failure",
        dependsOn: ["network"],
        autoStart: true,
      });
    } finally {
      server.stop(true);
    }
  });
});
