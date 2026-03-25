import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, writeConfig } from "./config";

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
      depot: true,
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
      depot: true,
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
      depot: true,
    });
  });
});
