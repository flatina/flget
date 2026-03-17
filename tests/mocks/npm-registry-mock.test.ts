import { describe, expect, test } from "bun:test";
import { createMockNpmRegistryServer } from "./npm-registry-mock";

describe("npm-registry-mock", () => {
  test("serves package metadata, search, and tarballs", async () => {
    const archive = new Bun.Archive({
      "package/package.json": new TextEncoder().encode(JSON.stringify({
        name: "@demo/cli",
        version: "1.0.0",
        bin: {
          demo: "bin/demo.js",
        },
      }, null, 2)),
      "package/bin/demo.js": new TextEncoder().encode("console.log('demo-v1');\n"),
    }, { compress: "gzip" });
    const bytes = await archive.bytes();
    const tarball = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const server = createMockNpmRegistryServer({
      packages: {
        "@demo/cli": {
          latest: "1.0.0",
          versions: {
            "1.0.0": tarball,
          },
        },
      },
    });

    try {
      const baseUrl = `http://127.0.0.1:${server.port}/`;

      const packageMeta = await fetch(`${baseUrl}@demo%2fcli`).then((response) => response.json()) as {
        name: string;
        "dist-tags": { latest: string };
      };
      expect(packageMeta.name).toBe("@demo/cli");
      expect(packageMeta["dist-tags"].latest).toBe("1.0.0");

      const search = await fetch(`${baseUrl}-/v1/search?text=demo&size=10`).then((response) => response.json()) as {
        objects: Array<{ package: { name: string } }>;
      };
      expect(search.objects[0]?.package.name).toBe("@demo/cli");

      const tarballResponse = await fetch(`${baseUrl}tarballs/%40demo%2Fcli/1.0.0.tgz`);
      expect(tarballResponse.status).toBe(200);
      expect(await tarballResponse.arrayBuffer()).toBeInstanceOf(ArrayBuffer);
    } finally {
      server.stop(true);
    }
  });
});
