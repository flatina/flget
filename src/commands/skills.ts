import { loadPackageMeta, listPackageMetas } from "../core/metadata";
import type { InstallOptions, RuntimeContext, SkillPackageMeta } from "../core/types";
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

export async function runSkillsCommand(
  context: RuntimeContext,
  args: string[],
  installOptions: InstallOptions,
  flags: Map<string, string | boolean>,
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
      await runInstallCommand(context, target, {
        ...installOptions,
        source: "skill",
      });
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
