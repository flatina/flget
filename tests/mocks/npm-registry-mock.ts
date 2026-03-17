import { readFile } from "node:fs/promises";
import { parseCliArgs, waitForExitSignal } from "../helpers/cli-main";

export interface MockNpmRegistryState {
  packages: Record<string, {
    latest: string;
    versions: Record<string, ArrayBuffer>;
  }>;
}

export function createMockNpmRegistryServer(state: MockNpmRegistryState, port = 0) {
  let server!: ReturnType<typeof Bun.serve>;
  server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request): Response {
      const url = new URL(request.url);
      const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const baseUrl = `http://127.0.0.1:${server.port}`;

      const packageState = state.packages[path];
      if (packageState) {
        return Response.json({
          name: path,
          "dist-tags": {
            latest: packageState.latest,
          },
          versions: Object.fromEntries(Object.keys(packageState.versions).map((version) => [
            version,
            {
              version,
              dist: {
                tarball: `${baseUrl}/tarballs/${encodeURIComponent(path)}/${encodeURIComponent(version)}.tgz`,
              },
            },
          ])),
        });
      }

      if (path === "-/v1/search") {
        const query = (url.searchParams.get("text") ?? "").toLowerCase();
        const size = Number(url.searchParams.get("size") ?? "10");
        const objects = Object.entries(state.packages)
          .filter(([name]) => name.toLowerCase().includes(query))
          .slice(0, size)
          .map(([name, packageState]) => ({
            package: {
              name,
              version: packageState.latest,
            },
          }));
        return Response.json({ objects });
      }

      const tarballMatch = path.match(/^tarballs\/(.+)\/([^/]+)\.tgz$/);
      if (tarballMatch) {
        const packageName = tarballMatch[1]!;
        const version = tarballMatch[2]!;
        const tarball = state.packages[packageName]?.versions[version];
        return tarball
          ? new Response(tarball, { headers: { "content-type": "application/gzip" } })
          : new Response("not found", { status: 404 });
      }

      return new Response("not found", { status: 404 });
    },
  });
  return server;
}

if (import.meta.main) {
  const args = parseCliArgs(process.argv.slice(2));
  const statePath = args.get("--state");
  if (!statePath) {
    throw new Error("--state is required");
  }

  const readyFilePath = args.get("--ready-file");
  const requestedPort = args.has("--port") ? Number(args.get("--port")) : 0;
  const rawState = JSON.parse(await readFile(statePath, "utf8")) as {
    packages: Record<string, { latest: string; versions: Record<string, string> }>;
  };

  const state: MockNpmRegistryState = {
    packages: Object.fromEntries(
      await Promise.all(
        Object.entries(rawState.packages).map(async ([name, packageState]) => [
          name,
          {
            latest: packageState.latest,
            versions: Object.fromEntries(
              await Promise.all(
                Object.entries(packageState.versions).map(async ([version, filePath]) => [
                  version,
                  await Bun.file(filePath).arrayBuffer(),
                ]),
              ),
            ),
          },
        ]),
      ),
    ),
  };

  const server = createMockNpmRegistryServer(state, requestedPort);
  const port = server.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  if (readyFilePath) {
    await Bun.write(readyFilePath, JSON.stringify({ baseUrl, port }));
  } else {
    console.log(JSON.stringify({ baseUrl, port }));
  }

  try {
    await waitForExitSignal();
  } finally {
    server.stop(true);
  }
}
