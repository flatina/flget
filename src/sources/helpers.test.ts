import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chooseBestBinCandidate,
  collectExecutableCandidates,
  finalizePreparedPackage,
  normalizeOverrideDaemonEntries,
  normalizeOverridePersist,
} from "./helpers";

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

  test("normalizes TOML-friendly persist override entries", () => {
    expect(normalizeOverridePersist({
      persist: [
        { source: "config.ini" },
        { source: "data", target: "appdata" },
      ],
    })).toEqual([
      { source: "config.ini", target: "config.ini" },
      { source: "data", target: "appdata" },
    ]);
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
