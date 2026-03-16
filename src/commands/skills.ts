import { createInterface } from "node:readline/promises";
import { loadPackageMeta, listPackageMetas } from "../core/metadata";
import type { InstallOptions, RuntimeContext, SkillPackageMeta } from "../core/types";
import type { DiscoveredSkill } from "../sources/skill-github";
import type { FlagValue } from "../utils/cli";
import { getBooleanFlag, getStringFlags } from "../utils/cli";
import { discoverSkillsInRepo, parseSkillRepoIdentifier } from "../sources/skill-github";
import { runInfoCommand } from "./info";
import { runInstallCommand } from "./install";
import { runRemoveCommand } from "./remove";
import { findSearchMatches } from "./search";
import { runUpdateCommand } from "./update";

function assertSkillMeta(id: string, meta: Awaited<ReturnType<typeof loadPackageMeta>>): asserts meta is SkillPackageMeta {
  if (!meta) {
    throw new Error(`Skill not found: ${id}`);
  }
  if (meta.installKind !== "skill") {
    throw new Error(`Not a skill: ${id}`);
  }
}

function toSkillInstallIdentifier(repoRef: string, skillId: string): string {
  const parsed = parseSkillRepoIdentifier(repoRef);
  if (!parsed) {
    throw new Error(`Invalid skill repository reference: ${repoRef}`);
  }
  const refSuffix = parsed.requestedRef ? `@${parsed.requestedRef}` : "";
  return `skill:${parsed.owner}/${parsed.repo}${refSuffix}#${skillId}`;
}

function printDiscoveredSkills(skills: DiscoveredSkill[]): void {
  for (const skill of skills) {
    console.log(`${skill.id}${skill.displayName && skill.displayName !== skill.id ? ` - ${skill.displayName}` : ""}`);
  }
}

function filterDiscoveredSkills(skills: DiscoveredSkill[], requestedNames: string[]): DiscoveredSkill[] {
  if (requestedNames.includes("*")) {
    return skills;
  }

  return skills.filter((skill) => requestedNames.some((name) => (
    skill.id.toLowerCase() === name.toLowerCase()
    || skill.displayName?.toLowerCase() === name.toLowerCase()
  )));
}

async function promptForSkills(skills: DiscoveredSkill[]): Promise<DiscoveredSkill[]> {
  console.log("Available skills:");
  for (const [index, skill] of skills.entries()) {
    console.log(`${index + 1}. ${skill.id}${skill.displayName && skill.displayName !== skill.id ? ` - ${skill.displayName}` : ""}`);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await rl.question("Select skills to install (comma-separated numbers, * for all): ")).trim();
    if (answer === "*") {
      return skills;
    }

    const indexes = answer
      .split(",")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isInteger(value));

    const selected = [...new Set(indexes)].map((value) => skills[value - 1]).filter((value): value is DiscoveredSkill => value !== undefined);
    if (selected.length === 0) {
      throw new Error("Invalid selection.");
    }
    return selected;
  } finally {
    rl.close();
  }
}

export async function runSkillsCommand(
  context: RuntimeContext,
  args: string[],
  installOptions: InstallOptions,
  flags: Map<string, FlagValue>,
): Promise<void> {
  const [subcommand, target] = args;

  switch (subcommand) {
    case "f":
    case "s":
    case "search":
    case "find": {
      if (!target) {
        throw new Error("Usage: flget skills find <query>");
      }
      const matches = await findSearchMatches(context, target.startsWith("skill:") ? target : `skill:${target}`, {
        includeSkills: true,
      });
      const skillMatches = matches.filter((match) => match.source === "skill");
      if (skillMatches.length === 0) {
        console.log("No matches found.");
        return;
      }
      for (const match of skillMatches) {
        console.log(match.line);
      }
      return;
    }
    case "a":
    case "i":
    case "add":
    case "install": {
      if (!target) {
        throw new Error("Usage: flget skills install <ref-or-query>");
      }
      const explicitSkills = getStringFlags(flags, "skill");
      const listOnly = getBooleanFlag(flags, "list") || getBooleanFlag(flags, "l");
      const installAll = getBooleanFlag(flags, "all");
      const parsedRepo = parseSkillRepoIdentifier(target);
      if (!parsedRepo) {
        if (explicitSkills.length > 0 || listOnly || installAll) {
          throw new Error("--skill, --list, and --all require an <owner>/<repo> target.");
        }
        await runInstallCommand(context, target, {
          ...installOptions,
          source: "skill",
        });
        return;
      }

      if (parsedRepo.subpath) {
        if (explicitSkills.length > 0 || listOnly || installAll) {
          throw new Error("Do not combine --skill, --list, or --all with an explicit #subpath.");
        }
        await runInstallCommand(context, target, {
          ...installOptions,
          source: "skill",
        });
        return;
      }

      const discovered = await discoverSkillsInRepo(context, target);
      if (discovered.length === 0) {
        throw new Error(`No skills found in ${target}`);
      }

      if (listOnly) {
        printDiscoveredSkills(discovered);
        return;
      }

      let selectedSkills: DiscoveredSkill[];
      if (installAll) {
        selectedSkills = discovered;
      } else if (explicitSkills.length > 0) {
        selectedSkills = filterDiscoveredSkills(discovered, explicitSkills);
        if (selectedSkills.length === 0) {
          console.log("Available skills:");
          printDiscoveredSkills(discovered);
          throw new Error(`No matching skills found for: ${explicitSkills.join(", ")}`);
        }
      } else if (discovered.length === 1) {
        selectedSkills = discovered;
      } else if (process.stdin.isTTY && process.stdout.isTTY) {
        selectedSkills = await promptForSkills(discovered);
      } else {
        throw new Error(
          `Multiple skills found in ${target}. Use --skill <name>, --all, or --list, or run in an interactive terminal.`,
        );
      }

      const failures: string[] = [];
      for (const skill of selectedSkills) {
        try {
          await runInstallCommand(context, toSkillInstallIdentifier(target, skill.id), {
            ...installOptions,
            source: "skill",
          });
        } catch (error) {
          failures.push(`${skill.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (failures.length > 0) {
        throw new Error(`Some skill installs failed:\n${failures.join("\n")}`);
      }
      return;
    }
    case "ls":
    case "list": {
      const skills = (await listPackageMetas(context.root)).filter((meta): meta is SkillPackageMeta => meta.installKind === "skill");
      if (flags.get("json") === true) {
        console.log(JSON.stringify(skills, null, 2));
        return;
      }
      if (skills.length === 0) {
        console.log("No skills installed.");
        return;
      }
      for (const skill of skills) {
        console.log(`${skill.id} ${skill.resolvedVersion}`);
      }
      return;
    }
    case "info": {
      if (!target) {
        throw new Error("Usage: flget skills info <id>");
      }
      const meta = await loadPackageMeta(context.root, target);
      assertSkillMeta(target, meta);
      await runInfoCommand(context.root, target);
      return;
    }
    case "upgrade":
    case "update": {
      const updateAll = flags.get("all") === true;
      if (!updateAll && !target) {
        throw new Error("Usage: flget skills update <id> or flget skills update --all");
      }
      if (updateAll) {
        const skills = (await listPackageMetas(context.root)).filter((meta): meta is SkillPackageMeta => meta.installKind === "skill");
        const failures: string[] = [];
        for (const skill of skills) {
          try {
            await runUpdateCommand(context, skill.id, false, false, installOptions);
          } catch (error) {
            failures.push(`${skill.id}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (failures.length > 0) {
          throw new Error(`Some skill updates failed:\n${failures.join("\n")}`);
        }
        return;
      }
      const meta = await loadPackageMeta(context.root, target!);
      assertSkillMeta(target!, meta);
      await runUpdateCommand(context, target, false, false, installOptions);
      return;
    }
    case "r":
    case "rm":
    case "remove": {
      if (!target) {
        throw new Error("Usage: flget skills remove <id>");
      }
      const meta = await loadPackageMeta(context.root, target);
      assertSkillMeta(target, meta);
      await runRemoveCommand(context, target);
      return;
    }
    default:
      throw new Error("Usage: flget skills <find|install|list|info|update|remove> ...");
  }
}
