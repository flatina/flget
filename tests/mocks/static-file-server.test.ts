import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StaticFileServer } from "./static-file-server";

describe("StaticFileServer", () => {
  test("serves staged files from a root directory", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "flget-static-server-"));
    await mkdir(join(rootPath, "repos", "flatina", "flget", "releases"), { recursive: true });
    await writeFile(join(rootPath, "index.html"), "<h1>ok</h1>", "utf8");
    await writeFile(join(rootPath, "repos", "flatina", "flget", "releases", "latest"), "{\"tag_name\":\"v0.1.2\"}\n", "utf8");

    const server = StaticFileServer.start(rootPath);
    try {
      const indexHtml = await fetch(`${server.baseUrl}/`).then((response) => response.text());
      expect(indexHtml).toContain("ok");

      const latest = await fetch(`${server.baseUrl}/repos/flatina/flget/releases/latest`).then((response) => response.json()) as {
        tag_name: string;
      };
      expect(latest.tag_name).toBe("v0.1.2");
    } finally {
      server.stop();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
