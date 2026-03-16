import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  bootstrapRoot,
  createMockNpmRegistryServer,
  createNpmTarball,
  createWorkspaceManager,
  runCli,
  runProcess,
  type MockNpmRegistryState,
} from "./helpers";

const { makeWorkspace, cleanupWorkspaces } = createWorkspaceManager();

afterEach(async () => {
  await cleanupWorkspaces();
});

describe("npm e2e", () => {
  test("npm search lists registry matches", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockNpmRegistryState = {
      packages: {
        "mock-npm-cli": {
          latest: "1.0.0",
          versions: {
            "1.0.0": await createNpmTarball("1.0.0", "npm-v1"),
          },
        },
      },
    };
    const server = createMockNpmRegistryServer(state);
    const env = {
      FLGET_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      const result = await runCli(["search", "npm:mock"], root, env);
      expect(result.stdout).toContain("npm:mock-npm-cli (1.0.0)");
    } finally {
      server.stop(true);
    }
  });

  test("mock npm registry install, update, and remove flow works end-to-end", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockNpmRegistryState = {
      packages: {
        "mock-npm-cli": {
          latest: "1.0.0",
          versions: {
            "1.0.0": await createNpmTarball("1.0.0", "npm-v1"),
            "2.0.0": await createNpmTarball("2.0.0", "npm-v2"),
          },
        },
      },
    };
    const server = createMockNpmRegistryServer(state);
    const env = {
      FLGET_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const install = await runCli(["install", "npm:mock-npm-cli"], root, env);
      expect(install.stdout).toContain("Installed mock-npm-cli@1.0.0");

      const infoV1 = JSON.parse((await runCli(["info", "mock-npm-cli"], root, env)).stdout) as {
        resolvedVersion: string;
        sourceType: string;
        displayName: string;
        runtime: string;
        bin: Array<{ name: string; target: string }>;
        interactiveEntries?: Array<{ name: string; target: string }>;
        daemonEntries?: unknown[];
      };
      expect(infoV1).toMatchObject({
        resolvedVersion: "1.0.0",
        sourceType: "npm",
        displayName: "mock-npm-cli",
        runtime: "bun-native",
      });
      expect(infoV1.bin[0]).toMatchObject({ name: "mock-npm", target: "bin/mock-npm.js" });
      expect(infoV1.interactiveEntries?.[0]).toMatchObject({ name: "mock-npm", target: "bin/mock-npm.js" });
      expect(infoV1.daemonEntries).toEqual([]);
      expect(await readFile(join(root, "npm", "mock-npm-cli", "current", "bin", "mock-npm.js"), "utf8")).toContain("npm-v1");

      state.packages["mock-npm-cli"]!.latest = "2.0.0";
      const update = await runCli(["update", "mock-npm-cli"], root, env);
      expect(update.stdout).toContain("Updated mock-npm-cli: 1.0.0 -> 2.0.0");

      const infoV2 = JSON.parse((await runCli(["info", "mock-npm-cli"], root, env)).stdout) as {
        resolvedVersion: string;
      };
      expect(infoV2.resolvedVersion).toBe("2.0.0");
      expect(await readFile(join(root, "npm", "mock-npm-cli", "current", "bin", "mock-npm.js"), "utf8")).toContain("npm-v2");
      expect(await Bun.file(join(root, "npm", "mock-npm-cli", "1.0.0", "package.json")).exists()).toBe(true);

      const remove = await runCli(["remove", "mock-npm-cli"], root, env);
      expect(remove.stdout).toContain("Removed mock-npm-cli");
      expect(await Bun.file(join(root, "shims", "mock-npm.cmd")).exists()).toBe(false);
      expect(await Bun.file(join(root, "npm", "mock-npm-cli", "flget.meta.json")).exists()).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("fund reports package.json funding links for installed npm packages", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockNpmRegistryState = {
      packages: {
        "mock-npm-cli": {
          latest: "1.0.0",
          versions: {
            "1.0.0": await createNpmTarball("1.0.0", "npm-fund", {
              packageJson: {
                funding: "https://github.com/sponsors/mocknpm",
                description: "Support mock npm",
              },
            }),
          },
        },
      },
    };
    const server = createMockNpmRegistryServer(state);
    const env = {
      FLGET_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      await runCli(["install", "npm:mock-npm-cli"], root, env);

      const fund = await runCli(["fund", "mock-npm-cli"], root, env);
      expect(fund.stdout).toContain("mock-npm-cli");
      expect(fund.stdout).toContain("https://github.com/sponsors/mocknpm");
      expect(fund.stdout).toContain("Support mock npm");
    } finally {
      server.stop(true);
    }
  });

  test("npm overrides can inject portable env vars for scoped packages", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockNpmRegistryState = {
      packages: {
        "@openai/codex": {
          latest: "1.0.0",
          versions: {
            "1.0.0": await createNpmTarball("1.0.0", "codex-mock", {
              packageJson: {
                name: "@openai/codex",
                bin: {
                  codex: "bin/mock-npm.js",
                },
              },
            }),
          },
        },
      },
    };
    const server = createMockNpmRegistryServer(state);
    const env = {
      FLGET_NPM_REGISTRY_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      await mkdir(join(root, "tmp", "registries", "local", "overrides", "npm"), { recursive: true });
      await Bun.write(
        join(root, "tmp", "registries", "local", "overrides", "npm", "openai--codex.toml"),
        [
          "[env]",
          "CODEX_HOME = '${FL_ROOT}\\.codex'",
          "",
        ].join("\n"),
      );

      const install = await runCli(["install", "npm:@openai/codex"], root, env);
      expect(install.stdout).toContain("Installed codex@1.0.0");

      const info = JSON.parse((await runCli(["info", "codex"], root, env)).stdout) as {
        envSet?: Record<string, string>;
      };
      expect(info.envSet).toEqual({
        CODEX_HOME: "${FL_ROOT}\\.codex",
      });

      const envCache = await readFile(join(root, "tmp", "cache-env-sets.txt"), "utf8");
      expect(envCache).toContain(`CODEX_HOME=${root}\\.codex`);

      const activated = await runProcess(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ". .\\activate.ps1; Write-Output $env:CODEX_HOME"],
        root,
        env,
      );
      expect(activated.exitCode).toBe(0);
      expect(activated.stdout).toContain(`${root}\\.codex`);
    } finally {
      server.stop(true);
    }
  });
});
