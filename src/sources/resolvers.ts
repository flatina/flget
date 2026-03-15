import type { AnySourceResolver } from "../core/types";
import { githubReleaseSource } from "./github-release";
import { skillGithubSource } from "./skill-github";
import { scoopSource } from "./scoop";
import { npmSource } from "./npm";
import { npmGithubSource } from "./npm-github";

export const resolvers = [
  githubReleaseSource,
  skillGithubSource,
  scoopSource,
  npmSource,
  npmGithubSource,
] satisfies readonly AnySourceResolver[];
