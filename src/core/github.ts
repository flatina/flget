import type { RuntimeContext } from "./types";
import { resolveGitHubToken } from "./secrets";

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

export interface GitHubRelease {
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubReleaseAsset[];
}

export interface GitHubRepo {
  default_branch: string;
  name: string;
  description?: string | null;
}

export interface GitHubSearchRepository {
  full_name: string;
  name: string;
  description: string | null;
  owner: {
    login: string;
  };
}

export interface GitHubCommit {
  sha: string;
}

function getGitHubApiBaseUrl(): string {
  return (process.env.FLGET_GITHUB_API_BASE_URL ?? "https://api.github.com").replace(/\/+$/, "");
}

export async function getGitHubHeaders(context: RuntimeContext): Promise<HeadersInit> {
  const token = await resolveGitHubToken(context);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "flget",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchGitHubJson<T>(context: RuntimeContext, path: string): Promise<T> {
  const response = await fetch(`${getGitHubApiBaseUrl()}${path}`, {
    headers: await getGitHubHeaders(context),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 404) {
      throw new Error(`GitHub resource not found: ${path}`);
    }
    if (response.status === 403) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      const reset = response.headers.get("x-ratelimit-reset");
      throw new Error(`GitHub API rate-limited for ${path} (remaining=${remaining ?? "?"}, reset=${reset ?? "?"})`);
    }
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText} (${path}) ${body}`);
  }

  return response.json() as Promise<T>;
}

async function fetchGitHubResponse(context: RuntimeContext, path: string): Promise<Response> {
  return fetch(`${getGitHubApiBaseUrl()}${path}`, {
    headers: await getGitHubHeaders(context),
  });
}

export async function getRepo(context: RuntimeContext, owner: string, repo: string): Promise<GitHubRepo> {
  return fetchGitHubJson<GitHubRepo>(context, `/repos/${owner}/${repo}`);
}

export async function getDefaultBranchHead(context: RuntimeContext, owner: string, repo: string): Promise<{ branch: string; sha: string }> {
  const repository = await getRepo(context, owner, repo);
  const commit = await fetchGitHubJson<GitHubCommit>(context, `/repos/${owner}/${repo}/commits/${repository.default_branch}`);
  return {
    branch: repository.default_branch,
    sha: commit.sha,
  };
}

export async function getLatestRelease(context: RuntimeContext, owner: string, repo: string): Promise<GitHubRelease | null> {
  const response = await fetch(`${getGitHubApiBaseUrl()}/repos/${owner}/${repo}/releases/latest`, {
    headers: await getGitHubHeaders(context),
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub latest release request failed: ${response.status} ${response.statusText} (${owner}/${repo}) ${body}`);
  }
  return response.json() as Promise<GitHubRelease>;
}

export async function getReleaseByTag(context: RuntimeContext, owner: string, repo: string, tag: string): Promise<GitHubRelease> {
  return fetchGitHubJson<GitHubRelease>(context, `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`);
}

export async function getFundingFileContent(context: RuntimeContext, owner: string, repo: string): Promise<string | null> {
  for (const path of [".github/FUNDING.yml", ".github/FUNDING.yaml"]) {
    const response = await fetchGitHubResponse(
      context,
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`,
    );
    if (response.status === 404) {
      continue;
    }
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub contents request failed: ${response.status} ${response.statusText} (${owner}/${repo}/${path}) ${body}`);
    }

    const payload = await response.json() as {
      type?: string;
      encoding?: string;
      content?: string;
    };
    if (payload.type !== "file" || payload.encoding !== "base64" || typeof payload.content !== "string") {
      throw new Error(`Unexpected GitHub contents payload for ${owner}/${repo}/${path}`);
    }
    return Buffer.from(payload.content.replace(/\s+/g, ""), "base64").toString("utf8");
  }

  return null;
}

export async function searchRepositories(
  context: RuntimeContext,
  query: string,
  perPage = 10,
): Promise<GitHubSearchRepository[]> {
  const response = await fetchGitHubJson<{ items?: GitHubSearchRepository[] }>(
    context,
    `/search/repositories?q=${encodeURIComponent(query)}&per_page=${perPage}`,
  );
  return response.items ?? [];
}

export function getTarballUrl(owner: string, repo: string, ref: string): string {
  return `${getGitHubApiBaseUrl()}/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`;
}
