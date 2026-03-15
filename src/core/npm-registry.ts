export interface NpmPackageVersion {
  version: string;
  dist?: {
    tarball?: string;
  };
}

export interface NpmPackageMetadata {
  name: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, NpmPackageVersion>;
}

export interface NpmSearchPackage {
  name: string;
  version: string;
  description?: string;
}

export interface NpmSearchResult {
  package: NpmSearchPackage;
}

function getNpmRegistryBaseUrl(): string {
  return (process.env.FLGET_NPM_REGISTRY_BASE_URL ?? "https://registry.npmjs.org").replace(/\/+$/, "");
}

function getEncodedPackageName(name: string): string {
  return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

export async function fetchNpmPackageMetadata(name: string): Promise<NpmPackageMetadata> {
  const response = await fetch(`${getNpmRegistryBaseUrl()}/${getEncodedPackageName(name)}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "flget",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 404) {
      throw new Error(`npm package not found: ${name}`);
    }
    throw new Error(`npm registry request failed: ${response.status} ${response.statusText} (${name}) ${body}`);
  }

  return response.json() as Promise<NpmPackageMetadata>;
}

export async function searchNpmPackages(query: string, size = 10): Promise<NpmSearchResult[]> {
  const response = await fetch(`${getNpmRegistryBaseUrl()}/-/v1/search?text=${encodeURIComponent(query)}&size=${size}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "flget",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`npm search request failed: ${response.status} ${response.statusText} (${query}) ${body}`);
  }

  const payload = await response.json() as { objects?: NpmSearchResult[] };
  return payload.objects ?? [];
}
