import { describe, expect, test } from "bun:test";
import { GitHubMock } from "./github-mock";

describe("GitHubMock", () => {
  test("serves release, repo, commit, tarball, funding, search, and asset endpoints", async () => {
    const mock = GitHubMock.start({
      releaseRepositories: {
        "flatina/flget": {
          latest: {
            tag_name: "v0.1.2",
            assets: [{
              name: "flget-win-x64.zip",
              browser_download_url: "http://example.test/flget-win-x64.zip",
            }],
          },
          tags: {
            "v0.1.2": {
              tag_name: "v0.1.2",
              assets: [{
                name: "flget-win-x64.zip",
                browser_download_url: "http://example.test/flget-win-x64.zip",
              }],
            },
          },
        },
      },
      repositories: {
        "mock/test-skill": {
          defaultBranch: "main",
          description: "demo skill",
        },
      },
      commits: {
        "mock/test-skill": {
          main: "1111111111111111111111111111111111111111",
        },
      },
      tarballs: {
        "mock/test-skill": {
          main: new TextEncoder().encode("tarball").buffer,
        },
      },
      fundingFiles: {
        "flatina/flget": "github: flatina\n",
      },
      searchRepositories: [{
        owner: "flatina",
        repo: "flget",
        description: "portable package manager",
      }],
      assetFiles: {
        "releases/demo.cmd": "@echo off\r\necho demo\r\n",
      },
      requiredAuthToken: "secret-token",
    });

    try {
      const latest = await fetch(`${mock.baseUrl}/repos/flatina/flget/releases/latest`).then((response) => response.json()) as {
        tag_name: string;
        assets: Array<{ name: string }>;
      };
      expect(latest.tag_name).toBe("v0.1.2");
      expect(latest.assets[0]?.name).toBe("flget-win-x64.zip");

      const repo = await fetch(`${mock.baseUrl}/repos/mock/test-skill`).then((response) => response.json()) as {
        default_branch: string;
        description: string | null;
      };
      expect(repo.default_branch).toBe("main");
      expect(repo.description).toBe("demo skill");

      const commit = await fetch(`${mock.baseUrl}/repos/mock/test-skill/commits/main`).then((response) => response.json()) as {
        sha: string;
      };
      expect(commit.sha).toBe("1111111111111111111111111111111111111111");

      const tarballUnauthorized = await fetch(`${mock.baseUrl}/repos/mock/test-skill/tarball/main`);
      expect(tarballUnauthorized.status).toBe(401);

      const tarballAuthorized = await fetch(`${mock.baseUrl}/repos/mock/test-skill/tarball/main`, {
        headers: { authorization: "Bearer secret-token" },
      });
      expect(await tarballAuthorized.text()).toBe("tarball");

      const funding = await fetch(`${mock.baseUrl}/repos/flatina/flget/contents/.github/FUNDING.yml`).then((response) => response.json()) as {
        content: string;
      };
      expect(Buffer.from(funding.content, "base64").toString("utf8")).toContain("github: flatina");

      const search = await fetch(`${mock.baseUrl}/search/repositories?q=portable`).then((response) => response.json()) as {
        items: Array<{ full_name: string }>;
      };
      expect(search.items[0]?.full_name).toBe("flatina/flget");

      const asset = await fetch(`${mock.baseUrl}/assets/releases/demo.cmd`).then((response) => response.text());
      expect(asset).toContain("demo");
    } finally {
      mock.stop();
    }
  });
});
