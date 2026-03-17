import { readFile } from "node:fs/promises";
import { parseCliArgs, waitForExitSignal } from "../helpers/cli-main";

export interface GitHubMockReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
  content_type?: string;
}

export interface GitHubMockRelease {
  tag_name: string;
  name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets: GitHubMockReleaseAsset[];
}

export interface GitHubMockRepository {
  defaultBranch?: string;
  description?: string | null;
}

export interface GitHubMockSearchRepository {
  owner: string;
  repo: string;
  description?: string | null;
}

export interface GitHubMockState {
  releaseRepositories?: Record<string, {
    latest?: GitHubMockRelease;
    tags?: Record<string, GitHubMockRelease>;
  }>;
  repositories?: Record<string, GitHubMockRepository>;
  commits?: Record<string, Record<string, string>>;
  tarballs?: Record<string, Record<string, ArrayBuffer>>;
  fundingFiles?: Record<string, string>;
  searchRepositories?: GitHubMockSearchRepository[];
  assetFiles?: Record<string, string | ArrayBuffer | Uint8Array>;
  requiredAuthToken?: string;
}

interface GitHubMockStateFile {
  releaseRepositories?: GitHubMockState["releaseRepositories"];
  repositories?: GitHubMockState["repositories"];
  commits?: GitHubMockState["commits"];
  tarballs?: Record<string, Record<string, string>>;
  fundingFiles?: GitHubMockState["fundingFiles"];
  searchRepositories?: GitHubMockState["searchRepositories"];
  assetFiles?: Record<string, string>;
  requiredAuthToken?: string;
}

export interface LegacyMockGitHubState {
  releaseTag: "v1.0.0" | "v2.0.0";
  npmReleaseTag: "v1.0.0" | "v2.0.0";
  skillSha: string;
  releaseAssets: Record<string, string>;
  npmTarballs: Record<string, ArrayBuffer>;
  skillTarballs: Record<string, ArrayBuffer>;
  fundingFiles?: Record<string, string>;
  repoDescriptions?: Record<string, string | null>;
  searchRepositories?: Array<{
    owner: string;
    repo: string;
    description?: string | null;
  }>;
  requiredAuthToken?: string;
}

function normalizeRelease(release: GitHubMockRelease, baseUrl: string): GitHubMockRelease {
  return {
    tag_name: release.tag_name,
    name: release.name ?? release.tag_name,
    draft: release.draft ?? false,
    prerelease: release.prerelease ?? false,
    assets: release.assets.map((asset) => ({
      ...asset,
      size: asset.size ?? 0,
      content_type: asset.content_type ?? "application/octet-stream",
      browser_download_url: asset.browser_download_url.startsWith("/")
        ? `${baseUrl}${asset.browser_download_url}`
        : asset.browser_download_url,
    })),
  };
}

function responseForAsset(body: string | ArrayBuffer | Uint8Array): Response {
  const payload = typeof body === "string"
    ? body
    : Buffer.from(body instanceof Uint8Array ? body : new Uint8Array(body));
  return new Response(payload, {
    headers: { "content-type": "application/octet-stream" },
  });
}

function createLegacyReleaseRepositoryState(state: LegacyMockGitHubState) {
  const releaseAsset = (tag: "v1.0.0" | "v2.0.0") => {
    const suffix = tag === "v1.0.0" ? "v1" : "v2";
    return {
      tag_name: tag,
      name: tag,
      draft: false,
      prerelease: false,
      assets: [{
        name: "test-ghr-windows.cmd",
        browser_download_url: `/assets/releases/test-ghr-${suffix}.cmd`,
      }],
    };
  };

  return {
    "mock/test-ghr": {
      latest: releaseAsset(state.releaseTag),
      tags: {
        "v1.0.0": releaseAsset("v1.0.0"),
        "v2.0.0": releaseAsset("v2.0.0"),
      },
    },
    "mock/test-npm": {
      latest: {
        tag_name: state.npmReleaseTag,
        name: state.npmReleaseTag,
        draft: false,
        prerelease: false,
        assets: [],
      },
      tags: {
        "v1.0.0": {
          tag_name: "v1.0.0",
          name: "v1.0.0",
          draft: false,
          prerelease: false,
          assets: [],
        },
        "v2.0.0": {
          tag_name: "v2.0.0",
          name: "v2.0.0",
          draft: false,
          prerelease: false,
          assets: [],
        },
      },
    },
  };
}

export class GitHubMock {
  private constructor(
    private readonly state: GitHubMockState,
    private readonly server: ReturnType<typeof Bun.serve>,
  ) {}

  static start(state: GitHubMockState): GitHubMock {
    return GitHubMock.startOnPort(state, 0);
  }

  static startOnPort(state: GitHubMockState, port: number): GitHubMock {
    let server!: ReturnType<typeof Bun.serve>;
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(request): Response {
        const url = new URL(request.url);
        const path = decodeURIComponent(url.pathname);
        const repoReleaseMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)\/releases\/(latest|tags\/(.+))$/);
        if (repoReleaseMatch) {
          const owner = repoReleaseMatch[1]!;
          const repo = repoReleaseMatch[2]!;
          const releaseTarget = repoReleaseMatch[3]!;
          const tag = repoReleaseMatch[4];
          const repoKey = `${owner}/${repo}`;
          const releaseRepo = state.releaseRepositories?.[repoKey];
          const release = releaseTarget === "latest"
            ? releaseRepo?.latest
            : tag
              ? releaseRepo?.tags?.[tag]
              : undefined;
          return release
            ? Response.json(normalizeRelease(release, `http://127.0.0.1:${server.port}`))
            : new Response("not found", { status: 404 });
        }

        if (path === "/search/repositories") {
          const query = (url.searchParams.get("q") ?? "").toLowerCase();
          const items = (state.searchRepositories ?? []).filter((entry) => {
            const fullName = `${entry.owner}/${entry.repo}`.toLowerCase();
            const description = (entry.description ?? "").toLowerCase();
            return fullName.includes(query) || description.includes(query);
          }).map((entry) => ({
            full_name: `${entry.owner}/${entry.repo}`,
            name: entry.repo,
            description: entry.description ?? null,
            owner: {
              login: entry.owner,
            },
          }));
          return Response.json({ items });
        }

        if (path.startsWith("/assets/")) {
          const key = path.slice("/assets/".length);
          const body = state.assetFiles?.[key];
          return body !== undefined
            ? responseForAsset(body)
            : new Response("not found", { status: 404 });
        }

        const repoMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)$/);
        if (repoMatch) {
          const owner = repoMatch[1]!;
          const repo = repoMatch[2]!;
          const repoState = state.repositories?.[`${owner}/${repo}`];
          return Response.json({
            default_branch: repoState?.defaultBranch ?? "main",
            name: repo,
            description: repoState?.description ?? null,
          });
        }

        const commitMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)\/commits\/(.+)$/);
        if (commitMatch) {
          const owner = commitMatch[1]!;
          const repo = commitMatch[2]!;
          const ref = commitMatch[3]!;
          const sha = state.commits?.[`${owner}/${repo}`]?.[ref];
          return sha
            ? Response.json({ sha })
            : new Response("not found", { status: 404 });
        }

        const tarballMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)\/tarball\/(.+)$/);
        if (tarballMatch) {
          if (state.requiredAuthToken && request.headers.get("authorization") !== `Bearer ${state.requiredAuthToken}`) {
            return new Response("unauthorized", { status: 401 });
          }

          const owner = tarballMatch[1]!;
          const repo = tarballMatch[2]!;
          const ref = decodeURIComponent(tarballMatch[3]!);
          const tarball = state.tarballs?.[`${owner}/${repo}`]?.[ref];
          return tarball
            ? new Response(tarball, { headers: { "content-type": "application/gzip" } })
            : new Response("not found", { status: 404 });
        }

        const fundingMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/\.github\/FUNDING\.(yml|yaml)$/);
        if (fundingMatch) {
          const owner = fundingMatch[1]!;
          const repo = fundingMatch[2]!;
          const content = state.fundingFiles?.[`${owner}/${repo}`];
          if (!content) {
            return new Response("not found", { status: 404 });
          }
          return Response.json({
            type: "file",
            encoding: "base64",
            content: Buffer.from(content, "utf8").toString("base64"),
          });
        }

        return new Response("not found", { status: 404 });
      },
    });

    return new GitHubMock(state, server);
  }

  get port(): number {
    const port = this.server.port;
    if (port === undefined) {
      throw new Error("GitHubMock server port is unavailable");
    }
    return port;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.server.port}`;
  }

  stop(force = true): void {
    this.server.stop(force);
  }
}

export function createMockGitHubServer(state: LegacyMockGitHubState): GitHubMock {
  const dynamicState = {} as GitHubMockState;
  Object.defineProperties(dynamicState, {
    releaseRepositories: {
      enumerable: true,
      get() {
        return createLegacyReleaseRepositoryState(state);
      },
    },
    repositories: {
      enumerable: true,
      get() {
        const repositories = Object.fromEntries(
          Object.entries(state.repoDescriptions ?? {}).map(([key, description]) => [
            key,
            {
              defaultBranch: "main",
              description,
            },
          ]),
        );

        if (!repositories["mock/test-skill"]) {
          repositories["mock/test-skill"] = {
            defaultBranch: "main",
            description: state.repoDescriptions?.["mock/test-skill"] ?? null,
          };
        }
        return repositories;
      },
    },
    commits: {
      enumerable: true,
      get() {
        return {
          "mock/test-skill": {
            main: state.skillSha,
          },
        };
      },
    },
    tarballs: {
      enumerable: true,
      get() {
        return {
          "mock/test-npm": state.npmTarballs,
          "mock/test-skill": state.skillTarballs,
        };
      },
    },
    fundingFiles: {
      enumerable: true,
      get() {
        return state.fundingFiles;
      },
    },
    searchRepositories: {
      enumerable: true,
      get() {
        return state.searchRepositories;
      },
    },
    assetFiles: {
      enumerable: true,
      get() {
        return Object.fromEntries(
          Object.entries(state.releaseAssets).map(([key, value]) => [`releases/${key}`, value]),
        );
      },
    },
    requiredAuthToken: {
      enumerable: true,
      get() {
        return state.requiredAuthToken;
      },
    },
  });

  return GitHubMock.start(dynamicState);
}

async function hydrateStateFile(rawState: GitHubMockStateFile): Promise<GitHubMockState> {
  return {
    releaseRepositories: rawState.releaseRepositories,
    repositories: rawState.repositories,
    commits: rawState.commits,
    tarballs: rawState.tarballs
      ? Object.fromEntries(
        await Promise.all(
          Object.entries(rawState.tarballs).map(async ([repoKey, refs]) => [
            repoKey,
            Object.fromEntries(
              await Promise.all(
                Object.entries(refs).map(async ([ref, filePath]) => [
                  ref,
                  await Bun.file(filePath).arrayBuffer(),
                ]),
              ),
            ),
          ]),
        ),
      )
      : undefined,
    fundingFiles: rawState.fundingFiles,
    searchRepositories: rawState.searchRepositories,
    assetFiles: rawState.assetFiles
      ? Object.fromEntries(
        await Promise.all(
          Object.entries(rawState.assetFiles).map(async ([assetKey, filePath]) => [
            assetKey,
            await Bun.file(filePath).arrayBuffer(),
          ]),
        ),
      )
      : undefined,
    requiredAuthToken: rawState.requiredAuthToken,
  };
}

if (import.meta.main) {
  const args = parseCliArgs(process.argv.slice(2));
  const statePath = args.get("--state");
  if (!statePath) {
    throw new Error("--state is required");
  }

  const port = args.has("--port") ? Number(args.get("--port")) : 0;
  const readyFilePath = args.get("--ready-file");
  const rawState = JSON.parse(await readFile(statePath, "utf8")) as GitHubMockStateFile;
  const state = await hydrateStateFile(rawState);
  const server = GitHubMock.startOnPort(state, port);

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
