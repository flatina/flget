import type {
  AnyResolvedSource,
  AnySourceResolver,
  InstallOptions,
  InstallSource,
  RuntimeContext,
  SourceResolver,
  SourceType,
  SourceTypeByCliSource,
} from "../core/types";
import { assertIdentifierSourceEnabled } from "../core/source-enablement";
import { resolvers } from "./resolvers";

export function listResolvers(): readonly AnySourceResolver[] {
  return resolvers;
}

export function getResolver(identifier: string): AnySourceResolver {
  const resolver = resolvers.find((candidate) => candidate.canHandle(identifier));
  if (!resolver) {
    throw new Error(`Unsupported source identifier: ${identifier}`);
  }
  return resolver;
}

export function getResolverByCliSource<T extends InstallSource>(source: T): SourceResolver<SourceTypeByCliSource<T>> {
  const resolver = resolvers.find((candidate) => candidate.family.cliSource === source);
  if (!resolver) {
    throw new Error(`Unsupported source family: ${source}`);
  }
  return resolver as unknown as SourceResolver<SourceTypeByCliSource<T>>;
}

export function getResolverBySourceType<T extends SourceType>(sourceType: T): SourceResolver<T> {
  const resolver = resolvers.find((candidate) => candidate.family.sourceType === sourceType);
  if (!resolver) {
    throw new Error(`Unsupported source type: ${sourceType}`);
  }
  return resolver as unknown as SourceResolver<T>;
}

export type SourceResolution = {
  [TSourceType in SourceType]: {
    resolver: SourceResolver<TSourceType, object>;
    resolved: AnyResolvedSource & { sourceType: TSourceType };
  };
}[SourceType];

export async function resolveSource(
  context: RuntimeContext,
  identifier: string,
  options: InstallOptions,
): Promise<SourceResolution> {
  assertIdentifierSourceEnabled(context.config, identifier);
  const resolver = getResolver(identifier);
  const resolved = await resolver.resolve(context, identifier, options);
  return { resolver, resolved } as unknown as SourceResolution;
}
