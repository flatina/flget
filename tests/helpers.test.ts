import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, writeConfig } from "../src/core/config";
import { applyExtractDir } from "../src/core/extract";
import { detectKnownSponsorLink, extractGitHubRepoRef, parseGitHubFundingYaml, parsePackageFunding } from "../src/core/funding";
import { applyPersistTransaction } from "../src/core/fs-transaction";
import { parseHashSpec } from "../src/core/hash";
import { loadPackageMeta } from "../src/core/metadata";
import { getPackageBaseRelativePath } from "../src/core/package-layout";
import { normalizePersistEntries } from "../src/core/persist";
import { ensureRootInitialized, ensureRootScripts } from "../src/core/root";
import { createShims } from "../src/core/shim";
import { inferPackageLocationFromRelativeParts } from "../src/core/source-family";
import { decryptSecretValue, encryptSecretsEnv } from "../src/core/secrets";
import { chooseBestBinCandidate, collectExecutableCandidates, finalizePreparedPackage, normalizeOverrideDaemonEntries } from "../src/sources/helpers";
import { detectShimType, inferShimRunner, wildcardToRegExp } from "../src/utils/strings";

describe("wildcardToRegExp", () => {
  test("matches glob-like asset names", () => {
    const pattern = wildcardToRegExp("ripgrep-*-windows-*.zip");
    expect(pattern.test("ripgrep-14.1.1-windows-x64.zip")).toBe(true);
    expect(pattern.test("ripgrep-14.1.1-linux-x64.tar.gz")).toBe(false);
  });
});

describe("detectShimType", () => {
  test("treats common JS module extensions as bun-run shims", () => {
    expect(detectShimType("bin/demo.js")).toBe("js");
    expect(detectShimType("bin/demo.cjs")).toBe("js");
    expect(detectShimType("bin/demo.mjs")).toBe("js");
  });

  test("treats common TS module extensions as bun-run shims", () => {
    expect(detectShimType("bin/demo.ts")).toBe("ts");
    expect(detectShimType("bin/demo.cts")).toBe("ts");
    expect(detectShimType("bin/demo.mts")).toBe("ts");
  });
});

describe("inferShimRunner", () => {
  test("infers runners from common script extensions", () => {
    expect(inferShimRunner("scripts/demo.ts")).toBe("bun");
    expect(inferShimRunner("scripts/demo.py")).toBe("python");
    expect(inferShimRunner("scripts/demo.sh")).toBe("bash");
  });
});

describe("normalizePersistEntries", () => {
  test("normalizes mixed persist definitions", () => {
    expect(normalizePersistEntries(["config.ini", ["data", "appdata"]])).toEqual([
      { source: "config.ini", target: "config.ini" },
      { source: "data", target: "appdata" },
    ]);
  });
});

describe("funding helpers", () => {
  test("extracts common GitHub repository URL shapes", () => {
    expect(extractGitHubRepoRef("https://github.com/example/demo")).toEqual({ owner: "example", repo: "demo" });
    expect(extractGitHubRepoRef("git+https://github.com/example/demo.git")).toEqual({ owner: "example", repo: "demo" });
    expect(extractGitHubRepoRef("git@github.com:example/demo.git")).toEqual({ owner: "example", repo: "demo" });
    expect(extractGitHubRepoRef("https://ko-fi.com/example")).toBeNull();
  });

  test("detects known sponsor links", () => {
    expect(detectKnownSponsorLink("https://github.com/sponsors/example")).toEqual({
      platform: "github",
      url: "https://github.com/sponsors/example",
    });
    expect(detectKnownSponsorLink("https://ko-fi.com/example")).toEqual({
      platform: "ko-fi",
      url: "https://ko-fi.com/example",
    });
    expect(detectKnownSponsorLink("https://example.com")).toBeNull();
  });

  test("parses package.json funding values", () => {
    expect(parsePackageFunding([
      "https://github.com/sponsors/example",
      { type: "Open Collective", url: "https://opencollective.com/example" },
    ])).toEqual([
      { platform: "github", url: "https://github.com/sponsors/example" },
      { platform: "open-collective", url: "https://opencollective.com/example" },
    ]);
  });

  test("parses GitHub FUNDING.yml", () => {
    expect(parseGitHubFundingYaml([
      "github: example",
      "ko_fi: example",
      "custom:",
      "  - https://buymeacoffee.com/example",
    ].join("\n"))).toEqual([
      { platform: "github", url: "https://github.com/sponsors/example" },
      { platform: "ko-fi", url: "https://ko-fi.com/example" },
      { platform: "buy-me-a-coffee", url: "https://buymeacoffee.com/example" },
    ]);
  });
});

describe("daemon entry helpers", () => {
  test("normalizes daemon override entries", () => {
    expect(normalizeOverrideDaemonEntries([{
      name: "demo-daemon",
      run: {
        target: "bin/demo.exe",
      },
      stop: {
        target: "bin/demo-stop.exe",
      },
      restartPolicy: "on-failure",
      dependsOn: ["network"],
      autoStart: true,
    }])).toEqual([{
      name: "demo-daemon",
      run: {
        name: "demo-daemon",
        target: "bin/demo.exe",
        type: "exe",
      },
      stop: {
        name: "demo-daemon-stop",
        target: "bin/demo-stop.exe",
        type: "exe",
      },
      status: undefined,
      restartPolicy: "on-failure",
      dependsOn: ["network"],
      autoStart: true,
    }]);
  });
});

describe("prepared package finalization", () => {
  test("rejects shim and persist paths that escape the staging directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-finalize-"));
    expect(() => finalizePreparedPackage(root, {
      portability: "portable",
      runtime: "bun-native",
      bin: [{
        name: "demo",
        target: "../outside/demo.js",
        type: "js",
      }],
      persist: [{
        source: "data",
        target: "data",
      }],
      warnings: [],
      notes: null,
    })).toThrow("Path escapes root");

    expect(() => finalizePreparedPackage(root, {
      portability: "portable",
      runtime: "bun-native",
      bin: [{
        name: "demo",
        target: "bin/demo.js",
        type: "js",
      }],
      persist: [{
        source: "data",
        target: "../outside/data",
      }],
      warnings: [],
      notes: null,
    })).toThrow("Path escapes root");
  });
});

describe("parseHashSpec", () => {
  test("infers algorithm from hash length", () => {
    expect(parseHashSpec("a".repeat(32)).algorithm).toBe("md5");
    expect(parseHashSpec("b".repeat(40)).algorithm).toBe("sha1");
    expect(parseHashSpec("c".repeat(64)).algorithm).toBe("sha256");
    expect(parseHashSpec("d".repeat(128)).algorithm).toBe("sha512");
  });
});

describe("flenc secrets envelope", () => {
  test("encrypts dotenv values with a self-describing one-line envelope", () => {
    const encrypted = encryptSecretsEnv("GITHUB_TOKEN=test-token\n", "top-secret");
    const value = encrypted.trim().slice("GITHUB_TOKEN=".length);

    expect(encrypted).toStartWith("GITHUB_TOKEN=FLENC[v1,");
    expect(value).toContain("cipher:AES256_GCM");
    expect(value).toContain("kdf:scrypt");
    expect(value).toContain("salt:");
    expect(value).toContain("iv:");
    expect(value).toContain("tag:");
    expect(value).toContain("data:");
    expect(decryptSecretValue(value, "top-secret")).toBe("test-token");
  });
});

describe("source family registry", () => {
  test("maps source types to install paths and infers them back from meta locations", () => {
    expect(getPackageBaseRelativePath("github-release", "ripgrep")).toBe("ghr\\ripgrep");
    expect(getPackageBaseRelativePath("skill-github", "codex")).toBe("agents\\skills\\codex");
    expect(inferPackageLocationFromRelativeParts(["npmgh", "pnpm", "flget.meta.json"])).toEqual({
      id: "pnpm",
      sourceType: "npm-github",
      installKind: "app",
    });
    expect(inferPackageLocationFromRelativeParts(["agents", "skills", "codex", "flget.meta.json"])).toEqual({
      id: "codex",
      sourceType: "skill-github",
      installKind: "skill",
    });
  });
});

describe("config source enablement", () => {
  test("defaults all sources to enabled when config file is missing or legacy", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-config-"));
    const defaultConfig = await readConfig(root);
    expect(defaultConfig.sources).toEqual({
      scoop: true,
      npm: true,
      ghr: true,
      npmgh: true,
      skill: true,
    });
    expect(defaultConfig.compatRegistries.official).toEqual([
      "https://github.com/flatina/flget-compat",
    ]);

    await writeFile(join(root, "flget.root.toml"), "version = 1\narch = ''\nlogLevel = \"info\"\nuseLocalOverrides = true\n");
    const legacyConfig = await readConfig(root);
    expect(legacyConfig.sources).toEqual({
      scoop: true,
      npm: true,
      ghr: true,
      npmgh: true,
      skill: true,
    });
  });

  test("round-trips source enablement settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-config-"));
    const config = await readConfig(root);
    config.sources.ghr = false;
    config.sources.skill = false;

    await writeConfig(root, config);
    const parsed = await readConfig(root);
    expect(parsed.sources).toEqual({
      scoop: true,
      npm: true,
      ghr: false,
      npmgh: true,
      skill: false,
    });
  });
});

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
    expect(cmd).toContain("bun run");
    expect(cmd).toContain("prettier.cjs");

    const ps1 = await readFile(join(root, "shims", "prettier.ps1"), "utf8");
    expect(ps1).toContain("& $bun run $target @args");

    const flgetCmd = await readFile(join(root, "shims", "flget.cmd"), "utf8");
    expect(flgetCmd).toContain("%SHIMDIR%\\..\\flget.js");

    const bunCmd = await readFile(join(root, "shims", "bun.cmd"), "utf8");
    expect(bunCmd).toContain("%SHIMDIR%\\..\\bun.exe");
    expect(bunCmd).toContain("where bun >nul 2>nul");

    const bunPs1 = await readFile(join(root, "shims", "bun.ps1"), "utf8");
    expect(bunPs1).toContain('Join-Path $PSScriptRoot "..\\bun.exe"');
    expect(bunPs1).toContain("& $bun @args");
  });
});

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
    expect(cmd).toContain("where bun >nul 2>nul");

    const ps1 = await readFile(join(root, "shims", "demo.ps1"), "utf8");
    expect(ps1).toContain('Join-Path $PSScriptRoot "..\\bun.exe"');
    expect(ps1).toContain('Join-Path $PSScriptRoot "..\\..\\bun.exe"');
    expect(ps1).toContain("Get-Command bun -ErrorAction SilentlyContinue");
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
});

describe("applyPersist", () => {
  test("respects persist target remapping inside the new version", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-persist-"));
    const oldVersion = join(root, "old");
    const current = join(root, "current");
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
    };

    await mkdir(join(oldVersion, "data"), { recursive: true });
    await mkdir(current, { recursive: true });
    await writeFile(join(oldVersion, "data", "settings.json"), "{\"from\":\"old\"}");

    await applyPersistTransaction(
      oldVersion,
      current,
      [{ source: "data/settings.json", target: "appdata/settings.json" }],
      logger,
    );

    expect(await readFile(join(current, "appdata", "settings.json"), "utf8")).toContain("\"old\"");
    expect(await Bun.file(join(current, "data", "settings.json")).exists()).toBe(false);
    expect(await Bun.file(join(oldVersion, "data", "settings.json")).exists()).toBe(false);
  });

  test("moves persisted data into current and leaves backup of replaced target", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-persist-"));
    const oldVersion = join(root, "old");
    const current = join(root, "current");
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
    };

    await mkdir(oldVersion, { recursive: true });
    await mkdir(current, { recursive: true });
    await writeFile(join(oldVersion, "data.txt"), "old-data");
    await writeFile(join(current, "data.txt"), "new-data");

    await applyPersistTransaction(
      oldVersion,
      current,
      [{ source: "data.txt", target: "data.txt" }],
      logger,
    );

    expect(await readFile(join(current, "data.txt"), "utf8")).toBe("old-data");
    expect(await readFile(join(current, "data.txt.flget-backup"), "utf8")).toBe("new-data");
  });

  test("rolls back earlier persist moves when a later one fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-persist-"));
    const oldVersion = join(root, "old");
    const current = join(root, "current");
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
    };

    await mkdir(oldVersion, { recursive: true });
    await mkdir(current, { recursive: true });
    await writeFile(join(oldVersion, "ok.txt"), "old-ok");
    await mkdir(join(oldVersion, "blocked"), { recursive: true });
    await writeFile(join(oldVersion, "blocked", "bad.txt"), "old-bad");
    await writeFile(join(current, "ok.txt"), "new-ok");
    await writeFile(join(current, "blocked"), "not-a-dir");

    await expect(applyPersistTransaction(
      oldVersion,
      current,
      [
        { source: "ok.txt", target: "ok.txt" },
        { source: "blocked/bad.txt", target: "blocked/bad.txt" },
      ],
      logger,
    )).rejects.toThrow("persist migration failed");

    expect(await readFile(join(oldVersion, "ok.txt"), "utf8")).toBe("old-ok");
    expect(await readFile(join(current, "ok.txt"), "utf8")).toBe("new-ok");
  });
});

describe("applyExtractDir", () => {
  test("treats a flattened extract_dir root as already satisfied", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-extract-"));
    await writeFile(join(root, "node.exe"), "node");
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(join(root, "bin", "npm.cmd"), "npm");

    await applyExtractDir(root, "node-v25.8.1-win-x64", "node-v25.8.1-win-x64");

    expect(await Bun.file(join(root, "node.exe")).exists()).toBe(true);
    expect(await Bun.file(join(root, "bin", "npm.cmd")).exists()).toBe(true);
  });

  test("strips a flattened root prefix before applying nested extract_dir", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-extract-"));
    await mkdir(join(root, "pkg", "bin"), { recursive: true });
    await writeFile(join(root, "pkg", "bin", "tool.exe"), "tool");

    await applyExtractDir(root, "archive-root/pkg", "archive-root");

    expect(await Bun.file(join(root, "bin", "tool.exe")).exists()).toBe(true);
    expect(await Bun.file(join(root, "pkg")).exists()).toBe(false);
  });
});

describe("collectExecutableCandidates", () => {
  test("includes modern JS and TS module entry extensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "flget-candidates-"));
    await mkdir(join(root, "bin"), { recursive: true });
    await writeFile(join(root, "bin", "demo.cjs"), "module.exports = {}\n");
    await writeFile(join(root, "bin", "demo.mjs"), "export {}\n");
    await writeFile(join(root, "bin", "demo.cts"), "export {}\n");
    await writeFile(join(root, "bin", "demo.mts"), "export {}\n");

    const candidates = await collectExecutableCandidates(root);
    expect(candidates).toEqual(expect.arrayContaining([
      "bin/demo.cjs",
      "bin/demo.mjs",
      "bin/demo.cts",
      "bin/demo.mts",
    ]));
  });
});

describe("chooseBestBinCandidate", () => {
  test("prefers exact repo-name match", () => {
    expect(chooseBestBinCandidate("ripgrep", [
      "bin/helper.exe",
      "rg.exe",
      "ripgrep.exe",
    ])).toEqual([
      {
        name: "ripgrep",
        target: "ripgrep.exe",
        type: "exe",
      },
    ]);
  });
});
