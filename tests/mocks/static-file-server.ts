import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, normalize } from "node:path";
import { parseCliArgs, waitForExitSignal } from "../helpers/cli-main";

function contentTypeFor(relativePath: string): string {
  if (relativePath.endsWith(".ps1")) {
    return "text/plain; charset=utf-8";
  }
  if (relativePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (relativePath.endsWith(".json") || relativePath.startsWith("repos/")) {
    return "application/json; charset=utf-8";
  }
  if (relativePath.endsWith(".zip")) {
    return "application/zip";
  }
  if (relativePath.endsWith(".cmd")) {
    return "application/octet-stream";
  }
  return "application/octet-stream";
}

export class StaticFileServer {
  private constructor(
    private readonly rootPath: string,
    private readonly server: ReturnType<typeof Bun.serve>,
  ) {}

  static start(rootPath: string, port = 0): StaticFileServer {
    let server!: ReturnType<typeof Bun.serve>;
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      async fetch(request): Promise<Response> {
        const url = new URL(request.url);
        const relativePath = url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname.replace(/^\/+/, ""));
        const normalizedPath = normalize(relativePath);
        if (normalizedPath.startsWith("..")) {
          return new Response("not found", { status: 404 });
        }

        const fullPath = join(rootPath, normalizedPath);
        try {
          await access(fullPath, fsConstants.R_OK);
        } catch {
          return new Response("not found", { status: 404 });
        }

        return new Response(Bun.file(fullPath), {
          headers: { "content-type": contentTypeFor(relativePath) },
        });
      },
    });

    return new StaticFileServer(rootPath, server);
  }

  get port(): number {
    const port = this.server.port;
    if (port === undefined) {
      throw new Error("StaticFileServer port is unavailable");
    }
    return port;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  stop(force = true): void {
    this.server.stop(force);
  }
}

if (import.meta.main) {
  const args = parseCliArgs(process.argv.slice(2));
  const rootPath = args.get("--root");
  if (!rootPath) {
    throw new Error("--root is required");
  }

  const port = args.has("--port") ? Number(args.get("--port")) : 0;
  const readyFilePath = args.get("--ready-file");
  const server = StaticFileServer.start(rootPath, port);

  if (readyFilePath) {
    await Bun.write(readyFilePath, JSON.stringify({ baseUrl: server.baseUrl, port: server.port }));
  } else {
    console.log(JSON.stringify({ baseUrl: server.baseUrl, port: server.port }));
  }

  try {
    await waitForExitSignal();
  } finally {
    server.stop();
  }
}
