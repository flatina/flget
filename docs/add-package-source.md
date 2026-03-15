# How to Add a Source

This guide shows how to add a new app source to `flget` using `glr` (GitLab Releases) as the example.

Use this when you want to add a source similar to `ghr`, `npm`, or `npmgh`.

## Scope

This guide assumes:

- the new source installs apps, not skills
- it should participate in `install`, `update`, `list`, `info`, `remove`, and `search`
- it should reuse the existing transaction, metadata, shim, and env-cache flows

## Design Rules

- Do not add source-specific commit logic. Reuse the existing rename-based install/update flow.
- Do not add `copy + delete` fallback for staging -> current.
- Keep source-specific logic inside `src/sources/*` and a small core API client if needed.
- Prefer deterministic tests with local mocks.
- If the source is Git-hosted, preserve the existing mock-hook style used by GitHub-based tests.

## Current Extension Points

The source system is split into two layers:

1. source family metadata
2. resolver implementation

Search and funding support are now source capabilities on the resolver, not command-local switch blocks.

Relevant files:

- `src/core/source-family.ts`
- `src/core/types.ts`
- `src/core/config.ts`
- `src/core/source-enablement.ts`
- `src/sources/resolvers.ts`
- `src/sources/index.ts`
- `src/commands/install.ts`
- `src/core/package-layout.ts`
- `src/core/metadata.ts`

## Step 1: Add the Source Family

Add a new family entry in `src/core/source-family.ts`.

For `glr`, add an entry equivalent to:

```ts
{
  sourceType: "gitlab-release",
  cliSource: "glr",
  installKind: "app",
  rootDirSegments: ["glr"],
  dirsKey: "glr",
}
```

This single entry drives:

- install source name: `--source glr`
- search prefix: `glr:...`
- package base path: `glr/<id>`
- metadata path inference

## Step 2: Extend Shared Types and Root Config

The source family entry updates `SourceType`, `InstallSource`, and `InstallKind` automatically, but the root layout and config types still need to know about the new source.

Update `src/core/types.ts`:

- add `glr: string` to `FlgetDirs`
- add `"gitlab-release": \`glr:${string}\`` to `SourceRefByType`

Update `src/core/dirs.ts`:

- add `glr: join(resolvedRoot, "glr")`
- create the directory in `ensureLayout()`

Update `src/core/types.ts`, `src/core/source-enablement.ts`, and `src/core/config.ts`:

- add `glr: boolean` to `SourceEnablementConfig`
- add `glr = true/false` handling to default config and TOML read/write
- keep omitted `[sources]` entries default-enabled, matching existing behavior

## Step 3: Implement a Core API Client

If the new source talks to an external service, create a dedicated client in `src/core/`.

For `glr`, use `src/core/gitlab.ts`.

Keep it focused on raw API concerns:

- get latest release
- get release by tag
- get download headers
- search projects if search support is needed

Do not put package extraction or shim logic here.

## Step 4: Implement the Resolver

Add a new resolver in `src/sources/gitlab-release.ts`.

A good template is `src/sources/github-release.ts`.

The resolver should:

- `canHandle()`:
  - accept `glr:<group>/<project>[@tag]`
- `resolve()`:
  - find the release/tag
  - choose the best asset
  - return a typed `ResolvedSource`
- `prepare()`:
  - download the selected asset
  - extract/copy into `stagingDir`
  - infer or override bins
  - return `PreparedPackage`

Recommended resolver shape:

```ts
interface GitLabReleaseResolvedExtra {
  group: string;
  project: string;
  asset: GitLabReleaseAsset;
}

export const gitlabReleaseSource: SourceResolver<"gitlab-release", GitLabReleaseResolvedExtra> = {
  family: getSourceFamilyByType("gitlab-release"),
  async resolve(context, identifier, options) {
    return {
      id: project.toLowerCase(),
      displayName: project,
      sourceType: "gitlab-release",
      sourceRef: identifier as SourceRef<"gitlab-release">,
      resolvedVersion: release.tag_name,
      resolvedRef: release.tag_name,
      installKind: "app",
      extra: {
        group,
        project,
        asset,
      },
    };
  },
};
```

## Step 5: Register the Resolver

Update `src/sources/resolvers.ts` and add the new resolver to the exported array.

That is enough for:

- exact source install
- update by stored `sourceRef`

## Step 6: Add Search Support

Search is implemented as resolver capabilities. Do not add source-specific search branching to `src/commands/search.ts` unless the generic resolver flow itself needs to change.

For a new app source, there are usually two changes:

1. implement `search()` on the resolver if broad search is supported
2. implement `findExact()` on the resolver if exact install matching is supported

For `glr`, add a provider similar to the GitHub-family search path:

- search GitLab projects
- return installable matches in the form:
  - `glr:group/project`

If the source has no practical search API, leave `search()` and `findExact()` undefined and the generic command flow will skip it.

If the source supports funding metadata, also implement `resolveFunding()` on the resolver so `flget fund` can surface it.

## Step 7: Update CLI Help and README

Update:

- `src/cli.ts`
- `README.md`

Add:

- the new `glr:<group>/<project>[@tag]` source format
- `--source glr`
- one exact install example
- one search example if supported

## Step 8: Add Tests

At minimum, add:

- one install/update/remove E2E flow
- one search E2E flow if search is supported
- one auth/token E2E flow if the service supports private assets

Recommended placement:

- `tests/e2e/glr.test.ts`

Use local mocks, not real network calls.

## Common Mistakes

- Adding a resolver without adding a source family entry
- Adding a source family entry without updating `FlgetDirs`, source enablement, and config TOML handling
- Hardcoding source-specific path logic outside `source-family.ts`
- Putting service API logic inside command files instead of a small client under `src/core/`
- Adding command-local search or funding switches instead of implementing resolver capabilities
- Using real external API calls in tests
- Adding a source that writes to registry or mutates global PATH in core flows
