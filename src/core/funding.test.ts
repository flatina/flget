import { describe, expect, test } from "bun:test";
import {
  detectKnownSponsorLink,
  extractGitHubRepoRef,
  parseGitHubFundingYaml,
  parsePackageFunding,
} from "./funding";

describe("funding helpers", () => {
  test("extracts common GitHub repository URL shapes", () => {
    expect(extractGitHubRepoRef("https://github.com/example/demo")).toEqual({ owner: "example", repo: "demo" });
    expect(extractGitHubRepoRef("git+https://github.com/example/demo.git")).toEqual({ owner: "example", repo: "demo" });
    expect(extractGitHubRepoRef("git@github.com:example/demo.git")).toEqual({ owner: "example", repo: "demo" });
    expect(extractGitHubRepoRef("https://ko-fi.com/example")).toBeNull();
  });

  test("detects known sponsor links", () => {
    expect(detectKnownSponsorLink("https://github.com/sponsors/example")).toEqual({
      platform: "github",
      url: "https://github.com/sponsors/example",
    });
    expect(detectKnownSponsorLink("https://ko-fi.com/example")).toEqual({
      platform: "ko-fi",
      url: "https://ko-fi.com/example",
    });
    expect(detectKnownSponsorLink("https://example.com")).toBeNull();
  });

  test("parses package.json funding values", () => {
    expect(parsePackageFunding([
      "https://github.com/sponsors/example",
      { type: "Open Collective", url: "https://opencollective.com/example" },
    ])).toEqual([
      { platform: "github", url: "https://github.com/sponsors/example" },
      { platform: "open-collective", url: "https://opencollective.com/example" },
    ]);
  });

  test("parses GitHub FUNDING.yml", () => {
    expect(parseGitHubFundingYaml([
      "github: example",
      "ko_fi: example",
      "custom:",
      "  - https://buymeacoffee.com/example",
    ].join("\n"))).toEqual([
      { platform: "github", url: "https://github.com/sponsors/example" },
      { platform: "ko-fi", url: "https://ko-fi.com/example" },
      { platform: "buy-me-a-coffee", url: "https://buymeacoffee.com/example" },
    ]);
  });
});
