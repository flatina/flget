import type { AnySourceResolver } from "../core/types";
import { githubReleaseSource } from "./github-release";
import { skillGithubSource } from "./skill-github";
import { scoopSource } from "./scoop";
import { npmSource } from "./npm";
import { npmGithubSource } from "./npm-github";
import { depotSource } from "./depot";

export const resolvers = [
  githubReleaseSource,
  skillGithubSource,
  scoopSource,
  npmSource,
  npmGithubSource,
  depotSource,
] satisfies readonly AnySourceResolver[];
