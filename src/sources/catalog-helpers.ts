import { searchRepositories } from "../core/github";
import { fetchNpmPackageMetadata, searchNpmPackages } from "../core/npm-registry";
import type { InstallSource, RuntimeContext, SourceSearchResult } from "../core/types";

export function matchesQuery(value: string | null | undefined, query: string): boolean {
  if (query === "") {
    return true;
  }
  return (value ?? "").toLowerCase().includes(query);
}

const gitHubRepositorySearchCache = new Map<string, Promise<Awaited<ReturnType<typeof searchRepositories>>>>();

async function searchRepositoriesCached(
  context: RuntimeContext,
  query: string,
  perPage: number,
): Promise<Awaited<ReturnType<typeof searchRepositories>>> {
  const key = `${process.env.FLGET_GITHUB_API_BASE_URL ?? "https://api.github.com"}\u0000${query.toLowerCase()}\u0000${perPage}`;
  const existing = gitHubRepositorySearchCache.get(key);
  if (existing) {
    return existing;
  }
  const task = searchRepositories(context, query, perPage);
  gitHubRepositorySearchCache.set(key, task);
  return task;
}

export async function searchNpmCatalog(query: string): Promise<SourceSearchResult[]> {
  const results = await searchNpmPackages(query, 10);
  return results
    .filter((entry) => matchesQuery(entry.package.name, query) || matchesQuery(entry.package.description, query))
    .map((entry) => ({
      identifier: `npm:${entry.package.name}`,
      line: `npm:${entry.package.name}${entry.package.version ? ` (${entry.package.version})` : ""}`,
      installable: true,
    }));
}

export async function findExactNpmCatalog(query: string): Promise<SourceSearchResult[]> {
  try {
    const metadata = await fetchNpmPackageMetadata(query);
    const latestVersion = metadata["dist-tags"]?.latest;
    return [{
      identifier: `npm:${metadata.name}`,
      line: `npm:${metadata.name}${latestVersion ? ` (${latestVersion})` : ""}`,
      installable: true,
    }];
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("npm package not found:")) {
      return [];
    }
    throw error;
  }
}

export async function searchGitHubCatalog(
  context: RuntimeContext,
  query: string,
  source: Extract<InstallSource, "ghr" | "npmgh" | "skill">,
): Promise<SourceSearchResult[]> {
  const repositories = await searchRepositoriesCached(context, query, 10);
  return repositories
    .filter((repo) => matchesQuery(repo.full_name, query) || matchesQuery(repo.description, query))
    .map((repo) => ({
      identifier: `${source}:${repo.owner.login}/${repo.name}`,
      line: `${source}:${repo.owner.login}/${repo.name}`,
      installable: true,
    }));
}

export async function findExactGitHubCatalog(
  context: RuntimeContext,
  query: string,
  source: Extract<InstallSource, "ghr" | "npmgh" | "skill">,
): Promise<SourceSearchResult[]> {
  const repositories = await searchRepositoriesCached(context, query, 25);
  const normalized = query.toLowerCase();
  return repositories
    .filter((repo) => repo.name.toLowerCase() === normalized || repo.full_name.toLowerCase() === normalized)
    .map((repo) => ({
      identifier: `${source}:${repo.owner.login}/${repo.name}`,
      line: `${source}:${repo.owner.login}/${repo.name}`,
      installable: true,
    }));
}
