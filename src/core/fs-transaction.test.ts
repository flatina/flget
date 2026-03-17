import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPersistTransaction } from "./fs-transaction";

describe("applyPersistTransaction", () => {
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
