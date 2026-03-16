import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  bootstrapRoot,
  cliPath,
  createMockGitHubServer,
  createSkillTarball,
  createTarGz,
  createWorkspaceManager,
  runCli,
  runProcess,
  type MockGitHubState,
} from "./helpers";

const { makeWorkspace, cleanupWorkspaces } = createWorkspaceManager();

afterEach(async () => {
  await cleanupWorkspaces();
});

describe("skill e2e", () => {
  test("skills find lists repository matches", async () => {
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
        { owner: "mock", repo: "test-skill", description: "skill search target" },
      ],
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);
      const result = await runCli(["skills", "find", "test-skill"], root, env);
      expect(result.stdout).toContain("skill:mock/test-skill");
    } finally {
      server.stop(true);
    }
  });

  test("skills compatibility aliases work", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "7777777777777777777777777777777777777777",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "7777777777777777777777777777777777777777": await createSkillTarball("7777777777777777777777777777777777777777", "skill-v1"),
        "8888888888888888888888888888888888888888": await createSkillTarball("8888888888888888888888888888888888888888", "skill-v2"),
      },
      searchRepositories: [
        { owner: "mock", repo: "test-skill", description: "skill search target" },
      ],
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const search = await runCli(["skills", "search", "test-skill"], root, env);
      expect(search.stdout).toContain("skill:mock/test-skill");

      const install = await runCli(["skills", "add", "mock/test-skill"], root, env);
      expect(install.stdout).toContain("Installed demo-skill@");

      const list = await runCli(["skills", "ls"], root, env);
      expect(list.stdout).toContain("demo-skill");

      state.skillSha = "8888888888888888888888888888888888888888";
      const update = await runCli(["skills", "upgrade", "--all"], root, env);
      expect(update.stdout).toContain("Updated demo-skill:");

      const remove = await runCli(["skills", "rm", "demo-skill"], root, env);
      expect(remove.stdout).toContain("Removed demo-skill");
    } finally {
      server.stop(true);
    }
  });

  test("skills add <repo> --all installs all skills in the repository", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "abababababababababababababababababababab",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "abababababababababababababababababababab": await createTarGz({
          ["skills/cowsay-ts/SKILL.md"]: `---
name: cowsay-ts
description: Cow skill
shims:
  - scripts/cowsay.ts
---

# cowsay-ts
`,
          ["skills/cowsay-ts/scripts/cowsay.ts"]: "console.log('moo');\n",
          ["skills/hello-ts/SKILL.md"]: `---
name: hello-ts
description: Hello skill
shims:
  - scripts/hello.ts
---

# hello-ts
`,
          ["skills/hello-ts/scripts/hello.ts"]: "console.log('hello');\n",
        }),
      },
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const install = await runCli(["skills", "add", "mock/test-skill", "--all"], root, env);
      expect(install.stdout).toContain("Installed cowsay-ts@");
      expect(install.stdout).toContain("Installed hello-ts@");

      const list = await runCli(["skills", "list"], root, env);
      expect(list.stdout).toContain("cowsay-ts");
      expect(list.stdout).toContain("hello-ts");

      expect(await Bun.file(join(root, "shims", "cowsay.cmd")).exists()).toBe(true);
      expect(await Bun.file(join(root, "shims", "hello.cmd")).exists()).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("skills add <repo> lists available skills with --list", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "efefefefefefefefefefefefefefefefefefefef",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "efefefefefefefefefefefefefefefefefefefef": await createTarGz({
          ["skills/cowsay-ts/SKILL.md"]: `---
name: cowsay-ts
description: Cow skill
shims:
  - scripts/cowsay.ts
---

# cowsay-ts
`,
          ["skills/cowsay-ts/scripts/cowsay.ts"]: "console.log('moo');\n",
          ["skills/hello-ts/SKILL.md"]: `---
name: hello-ts
description: Hello skill
shims:
  - scripts/hello.ts
---

# hello-ts
`,
          ["skills/hello-ts/scripts/hello.ts"]: "console.log('hello');\n",
        }),
      },
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const listed = await runCli(["skills", "add", "mock/test-skill", "--list"], root, env);
      expect(listed.stdout).toContain("cowsay-ts");
      expect(listed.stdout).toContain("hello-ts");

      const list = await runCli(["skills", "list"], root, env);
      expect(list.stdout).toContain("No skills installed.");
    } finally {
      server.stop(true);
    }
  });

  test("skills add <repo> --skill <id> installs only the selected skill", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd": await createTarGz({
          ["skills/cowsay-ts/SKILL.md"]: `---
name: cowsay-ts
description: Cow skill
shims:
  - scripts/cowsay.ts
---

# cowsay-ts
`,
          ["skills/cowsay-ts/scripts/cowsay.ts"]: "console.log('moo');\n",
          ["skills/hello-ts/SKILL.md"]: `---
name: hello-ts
description: Hello skill
shims:
  - scripts/hello.ts
---

# hello-ts
`,
          ["skills/hello-ts/scripts/hello.ts"]: "console.log('hello');\n",
        }),
      },
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const install = await runCli(["skills", "add", "mock/test-skill", "--skill", "cowsay-ts"], root, env);
      expect(install.stdout).toContain("Installed cowsay-ts@");
      expect(install.stdout).not.toContain("hello-ts");

      const list = await runCli(["skills", "list"], root, env);
      expect(list.stdout).toContain("cowsay-ts");
      expect(list.stdout).not.toContain("hello-ts");

      expect(await Bun.file(join(root, "shims", "cowsay.cmd")).exists()).toBe(true);
      expect(await Bun.file(join(root, "shims", "hello.cmd")).exists()).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("skills add <repo> accepts repeated --skill flags", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "edededededededededededededededededededed",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "edededededededededededededededededededed": await createTarGz({
          ["skills/cowsay-ts/SKILL.md"]: `---
name: cowsay-ts
description: Cow skill
shims:
  - scripts/cowsay.ts
---

# cowsay-ts
`,
          ["skills/cowsay-ts/scripts/cowsay.ts"]: "console.log('moo');\n",
          ["skills/hello-ts/SKILL.md"]: `---
name: hello-ts
description: Hello skill
shims:
  - scripts/hello.ts
---

# hello-ts
`,
          ["skills/hello-ts/scripts/hello.ts"]: "console.log('hello');\n",
        }),
      },
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const install = await runCli(["skills", "add", "mock/test-skill", "--skill", "cowsay-ts", "--skill", "hello-ts"], root, env);
      expect(install.stdout).toContain("Installed cowsay-ts@");
      expect(install.stdout).toContain("Installed hello-ts@");

      const list = await runCli(["skills", "list"], root, env);
      expect(list.stdout).toContain("cowsay-ts");
      expect(list.stdout).toContain("hello-ts");
    } finally {
      server.stop(true);
    }
  });

  test("skills add <repo> without selection errors non-interactively when multiple skills exist", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "dededededededededededededededededededede",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "dededededededededededededededededededede": await createTarGz({
          ["skills/cowsay-ts/SKILL.md"]: `---
name: cowsay-ts
description: Cow skill
shims:
  - scripts/cowsay.ts
---

# cowsay-ts
`,
          ["skills/cowsay-ts/scripts/cowsay.ts"]: "console.log('moo');\n",
          ["skills/hello-ts/SKILL.md"]: `---
name: hello-ts
description: Hello skill
shims:
  - scripts/hello.ts
---

# hello-ts
`,
          ["skills/hello-ts/scripts/hello.ts"]: "console.log('hello');\n",
        }),
      },
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const result = await runProcess([process.execPath, cliPath, "skills", "add", "mock/test-skill"], root, env);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Multiple skills found");
      expect(result.stderr).toContain("--skill");
    } finally {
      server.stop(true);
    }
  });

  test("mock GitHub skill install, update, and remove flow works end-to-end", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "1111111111111111111111111111111111111111",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "1111111111111111111111111111111111111111": await createSkillTarball("1111111111111111111111111111111111111111", "skill-v1"),
        "2222222222222222222222222222222222222222": await createSkillTarball("2222222222222222222222222222222222222222", "skill-v2"),
      },
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const install = await runCli(["install", "skill:mock/test-skill"], root, env);
      expect(install.stdout).toContain("Installed test-skill@");

      const infoV1 = JSON.parse((await runCli(["info", "test-skill"], root, env)).stdout) as {
        resolvedVersion: string;
        sourceType: string;
        displayName: string;
        runtime: string;
        bin: Array<{ name: string; target: string }>;
        skill?: { folderPath: string; folderHash: string };
      };
      expect(infoV1).toMatchObject({
        resolvedVersion: "111111111111",
        sourceType: "skill-github",
      });
      expect(infoV1.bin[0]).toMatchObject({ name: "demo-skill-cli", target: "scripts/demo-skill.ts" });
      expect(infoV1.displayName).toBe("demo-skill");
      expect(infoV1.skill?.folderHash.startsWith("sha256:")).toBe(true);
      expect(await readFile(join(root, "agents", "skills", "test-skill", "current", "scripts", "demo-skill.ts"), "utf8")).toContain("skill-v1");
      expect(await Bun.file(join(root, "shims", "demo-skill-cli.cmd")).exists()).toBe(true);

      state.skillSha = "2222222222222222222222222222222222222222";
      const update = await runCli(["update", "test-skill"], root, env);
      expect(update.stdout).toContain("Updated test-skill: 111111111111 -> 222222222222");

      const infoV2 = JSON.parse((await runCli(["info", "test-skill"], root, env)).stdout) as {
        resolvedVersion: string;
      };
      expect(infoV2.resolvedVersion).toBe("222222222222");
      expect(await readFile(join(root, "agents", "skills", "test-skill", "current", "scripts", "demo-skill.ts"), "utf8")).toContain("skill-v2");
      expect(await Bun.file(join(root, "agents", "skills", "test-skill", "111111111111", "scripts", "demo-skill.ts")).exists()).toBe(true);

      const remove = await runCli(["remove", "test-skill"], root, env);
      expect(remove.stdout).toContain("Removed test-skill");
      expect(await Bun.file(join(root, "shims", "demo-skill-cli.cmd")).exists()).toBe(false);
      expect(await Bun.file(join(root, "agents", "skills", "test-skill", "flget.meta.json")).exists()).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("skill update skips commit when folder content hash is unchanged", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "5555555555555555555555555555555555555555",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "5555555555555555555555555555555555555555": await createSkillTarball("5555555555555555555555555555555555555555", "skill-stable"),
        "6666666666666666666666666666666666666666": await createSkillTarball("6666666666666666666666666666666666666666", "skill-stable"),
      },
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      await runCli(["install", "skill:mock/test-skill"], root, env);
      state.skillSha = "6666666666666666666666666666666666666666";

      const update = await runCli(["update", "test-skill"], root, env);
      expect(update.stdout).toContain("test-skill skill content is already up to date.");

      const info = JSON.parse((await runCli(["info", "test-skill"], root, env)).stdout) as {
        resolvedVersion: string;
        skill?: { folderHash: string };
      };
      expect(info.resolvedVersion).toBe("666666666666");
      expect(info.skill?.folderHash.startsWith("sha256:")).toBe(true);
      expect(await readFile(join(root, "agents", "skills", "test-skill", "current", "scripts", "demo-skill.ts"), "utf8")).toContain("skill-stable");
      expect(await Bun.file(join(root, "agents", "skills", "test-skill", "555555555555")).exists()).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("skill install discovers skills under .codex/skills", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "3333333333333333333333333333333333333333",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "3333333333333333333333333333333333333333": await createSkillTarball("3333333333333333333333333333333333333333", "codex-skill", "codex"),
      },
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const install = await runCli(["install", "skill:mock/test-skill"], root, env);
      expect(install.stdout).toContain("Installed test-skill@");

      const info = JSON.parse((await runCli(["info", "test-skill"], root, env)).stdout) as {
        displayName: string;
        bin: Array<{ name: string; target: string }>;
        skill?: { folderPath: string };
      };
      expect(info.displayName).toBe("demo-skill");
      expect(info.bin[0]).toMatchObject({ name: "demo-skill-cli", target: "scripts/demo-skill.ts" });
      expect(info.skill?.folderPath).toContain("demo-skill");
      expect(await readFile(join(root, "agents", "skills", "test-skill", "current", "scripts", "demo-skill.ts"), "utf8")).toContain("codex-skill");
    } finally {
      server.stop(true);
    }
  });

  test("skill install resolves #subpath under a skills/ directory", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": await createTarGz({
          ["skills/cowsay-ts/SKILL.md"]: `---
name: cowsay-ts
description: Skill in a nested skills directory
shims:
  - scripts/cowsay.ts
---

# cowsay-ts
`,
          ["skills/cowsay-ts/scripts/cowsay.ts"]: "console.log('moo');\n",
        }),
      },
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const install = await runCli(["install", "skill:mock/test-skill#cowsay-ts"], root, env);
      expect(install.stdout).toContain("Installed cowsay-ts@");

      const info = JSON.parse((await runCli(["info", "cowsay-ts"], root, env)).stdout) as {
        displayName: string;
        skill?: { folderPath: string };
      };
      expect(info.displayName).toBe("cowsay-ts");
      expect(info.skill?.folderPath).toBeDefined();
      expect(["cowsay-ts", "skills/cowsay-ts"]).toContain(info.skill?.folderPath ?? "");
      expect(await Bun.file(join(root, "shims", "cowsay.cmd")).exists()).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("skill shims support shorthand entries and per-entry runners", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "9999999999999999999999999999999999999999",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "9999999999999999999999999999999999999999": await createTarGz({
          ["skills/demo-skill/SKILL.md"]: `---
name: demo-skill
description: Skill with mixed shims
shims:
  - scripts/tool.py
  - target: scripts/deploy.sh
    name: deploy
    runner: bash
---

# Demo Skill
`,
          ["skills/demo-skill/scripts/tool.py"]: "print('tool')\n",
          ["skills/demo-skill/scripts/deploy.sh"]: "echo deploy\n",
        }),
      },
      requiredAuthToken: undefined,
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
    };

    try {
      await bootstrapRoot(root, env);

      const install = await runCli(["install", "skill:mock/test-skill"], root, env);
      expect(install.stdout).toContain("Installed test-skill@");

      const info = JSON.parse((await runCli(["info", "test-skill"], root, env)).stdout) as {
        runtime: string;
        bin: Array<{ name: string; target: string; runner?: string }>;
      };
      expect(info.runtime).toBe("runtime-dependent");
      expect(info.bin).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "tool", target: "scripts/tool.py", runner: "python" }),
        expect.objectContaining({ name: "deploy", target: "scripts/deploy.sh", runner: "bash" }),
      ]));
      expect(await Bun.file(join(root, "shims", "deploy.cmd")).exists()).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("skill tarball downloads honor GitHub token from environment", async () => {
    const workspace = await makeWorkspace();
    const root = join(workspace.dir, "root");
    const state: MockGitHubState = {
      releaseTag: "v1.0.0",
      npmReleaseTag: "v1.0.0",
      skillSha: "4444444444444444444444444444444444444444",
      releaseAssets: {},
      npmTarballs: {},
      skillTarballs: {
        "4444444444444444444444444444444444444444": await createSkillTarball("4444444444444444444444444444444444444444", "skill-auth"),
      },
      requiredAuthToken: "test-token",
    };
    const server = createMockGitHubServer(state);
    const env = {
      FLGET_GITHUB_API_BASE_URL: `http://127.0.0.1:${server.port}`,
      GITHUB_TOKEN: "test-token",
    };

    try {
      await bootstrapRoot(root, env);
      const install = await runCli(["install", "skill:mock/test-skill"], root, env);
      expect(install.stdout).toContain("Installed test-skill@");
    } finally {
      server.stop(true);
    }
  });
});
