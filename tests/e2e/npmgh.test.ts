import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encryptSecretsEnv } from "../../src/core/secrets";
import {
  bootstrapRoot,
  createMockGitHubServer,
  createNpmTarball,
  createWorkspaceManager,
  fixtureRoot,
  runCli,
  type MockGitHubState,
} from "./helpers";

const { makeWorkspace, cleanupWorkspaces } = createWorkspaceManager();

afterEach(async () => {
  await cleanupWorkspaces();
});

describe("npmgh e2e", () => {
  test("npmgh search lists repository matches", async () => {
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
        { owner: "mock", repo: "test-npm", description: "npm github search target" },
      ],
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      const result = await runCli(["search", "npmgh:test-npm"], root, env);
      expect(result.stdout).toContain("npmgh:mock/test-npm");
    } finally {
      server.stop(true);
    }
  });

  test("mock npm GitHub install, update, and remove flow works end-to-end", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {},
      npmTarballs: {
        "v1.0.0": await createNpmTarball("1.0.0", "npm-v1"),
        "v2.0.0": await createNpmTarball("2.0.0", "npm-v2"),
      },
      skillTarballs: {},
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const install = await runCli(["install", "npmgh:mock/test-npm"], root, env);
      expect(install.stdout).toContain("Installed test-npm@v1.0.0");

      const infoV1 = JSON.parse((await runCli(["info", "test-npm"], root, env)).stdout) as {
        resolvedVersion: string;
        sourceType: string;
        displayName: string;
        runtime: string;
        bin: Array<{ name: string; target: string }>;
        interactiveEntries?: Array<{ name: string; target: string }>;
        daemonEntries?: unknown[];
      };
      expect(infoV1).toMatchObject({
        resolvedVersion: "v1.0.0",
        sourceType: "npm-github",
        displayName: "mock-npm-cli",
        runtime: "bun-native",
      });
      expect(infoV1.bin[0]).toMatchObject({ name: "mock-npm", target: "bin/mock-npm.js" });
      expect(infoV1.interactiveEntries?.[0]).toMatchObject({ name: "mock-npm", target: "bin/mock-npm.js" });
      expect(infoV1.daemonEntries).toEqual([]);
      expect(await readFile(join(root, "npmgh", "test-npm", "current", "bin", "mock-npm.js"), "utf8")).toContain("npm-v1");
      expect(await Bun.file(join(root, "shims", "mock-npm.cmd")).exists()).toBe(true);

      state.npmReleaseTag = "v2.0.0";
      const update = await runCli(["update", "test-npm"], root, env);
      expect(update.stdout).toContain("Updated test-npm: v1.0.0 -> v2.0.0");

      const infoV2 = JSON.parse((await runCli(["info", "test-npm"], root, env)).stdout) as {
        resolvedVersion: string;
      };
      expect(infoV2.resolvedVersion).toBe("v2.0.0");
      expect(await readFile(join(root, "npmgh", "test-npm", "current", "bin", "mock-npm.js"), "utf8")).toContain("npm-v2");
      expect(await Bun.file(join(root, "npmgh", "test-npm", "v1.0.0", "package.json")).exists()).toBe(true);

      const remove = await runCli(["remove", "test-npm"], root, env);
      expect(remove.stdout).toContain("Removed test-npm");
      expect(await Bun.file(join(root, "shims", "mock-npm.cmd")).exists()).toBe(false);
      expect(await Bun.file(join(root, "npmgh", "test-npm", "flget.meta.json")).exists()).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("fund reads local FUNDING.yml for installed npmgh packages", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {},
      npmTarballs: {
        "v1.0.0": await createNpmTarball("1.0.0", "npmgh-fund", {
          packageJson: {
            description: "Support npmgh package",
          },
          extraFiles: {
            "package/.github/FUNDING.yml": "patreon: mocknpmgh\n",
          },
        }),
      },
      skillTarballs: {},
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      await runCli(["install", "npmgh:mock/test-npm"], root, env);

      const fund = await runCli(["fund", "test-npm"], root, env);
      expect(fund.stdout).toContain("test-npm");
      expect(fund.stdout).toContain("https://patreon.com/mocknpmgh");
      expect(fund.stdout).toContain("Support npmgh package");
    } finally {
      server.stop(true);
    }
  });

  test("npm tarball downloads honor GitHub token from environment", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {},
      npmTarballs: {
        "v1.0.0": await createNpmTarball("1.0.0", "npm-auth"),
      },
      skillTarballs: {},
      requiredAuthToken: "test-token",
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
      GITHUB_TOKEN: "test-token",
    };

    try {
      await bootstrapRoot(root, env);
      const install = await runCli(["install", "npmgh:mock/test-npm"], root, env);
      expect(install.stdout).toContain("Installed test-npm@v1.0.0");
    } finally {
      server.stop(true);
    }
  });

  test("npm tarball downloads use root .env before shared secrets env", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {},
      npmTarballs: {
        "v1.0.0": await createNpmTarball("1.0.0", "npm-auth-dotenv"),
      },
      skillTarballs: {},
      requiredAuthToken: "test-token",
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      await writeFile(join(root, ".env"), "GITHUB_TOKEN=test-token\n", "utf8");
      await writeFile(join(root, ".secrets", ".env"), "GITHUB_TOKEN=wrong-token\n", "utf8");

      const install = await runCli(["install", "npmgh:mock/test-npm"], root, env);
      expect(install.stdout).toContain("Installed test-npm@v1.0.0");
    } finally {
      server.stop(true);
    }
  });

  test("npm tarball downloads honor GitHub token from shared secrets env", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {},
      npmTarballs: {
        "v1.0.0": await createNpmTarball("1.0.0", "npm-auth-secret"),
      },
      skillTarballs: {},
      requiredAuthToken: "test-token",
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      await writeFile(join(root, ".secrets", ".env"), "GITHUB_TOKEN=test-token\n", "utf8");
      const install = await runCli(["install", "npmgh:mock/test-npm"], root, env);
      expect(install.stdout).toContain("Installed test-npm@v1.0.0");
    } finally {
      server.stop(true);
    }
  });

  test("npm tarball downloads honor GitHub token from encrypted shared secrets env", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {},
      npmTarballs: {
        "v1.0.0": await createNpmTarball("1.0.0", "npm-auth-shared-encrypted"),
      },
      skillTarballs: {},
      requiredAuthToken: "test-token",
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
      FLGET_SECRETS_KEY: "top-secret",
    };

    try {
      await bootstrapRoot(root, env);
      await writeFile(
        join(root, ".secrets", ".env.flenc"),
        encryptSecretsEnv("GITHUB_TOKEN=test-token\n", "top-secret"),
        "utf8",
      );
      const install = await runCli(["install", "npmgh:mock/test-npm"], root, env);
      expect(install.stdout).toContain("Installed test-npm@v1.0.0");
    } finally {
      server.stop(true);
    }
  });

  test("npm tarball downloads honor GitHub token from encrypted profile secrets env", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {},
      npmTarballs: {
        "v1.0.0": await createNpmTarball("1.0.0", "npm-auth-profile-encrypted"),
      },
      skillTarballs: {},
      requiredAuthToken: "test-token",
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
      FLGET_PROFILE: "alice",
      FLGET_SECRETS_KEY: "top-secret",
    };

    try {
      await bootstrapRoot(root, env);
      await writeFile(
        join(root, ".secrets", "alice.env.flenc"),
        encryptSecretsEnv("GITHUB_TOKEN=test-token\n", "top-secret"),
        "utf8",
      );
      const install = await runCli(["install", "npmgh:mock/test-npm"], root, env);
      expect(install.stdout).toContain("Installed test-npm@v1.0.0");
    } finally {
      server.stop(true);
    }
  });
});
