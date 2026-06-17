/**
 * Procedure types produced by `.mutation()` / `.query()` on the builder.
 *
 * These carry the version map, terminal versions, and declaration order
 * in meta — which the client reads to do per-pin narrowing.
 */
import type {
  TRPCMutationProcedure,
  TRPCQueryProcedure,
} from "@trpc/server";

type Versions = Record<
  string,
  { input: unknown } | { input: unknown; output: unknown }
>;

export interface VersionedMutation<
  V extends Versions,
  T extends string,
  Order extends readonly (keyof V & string)[]
> extends TRPCMutationProcedure<{
    input: V[keyof V]["input"];
    output: Extract<V[T & keyof V], { output: unknown }>["output"];
    meta: { versions: V; terminalVersions: T; order: Order };
  }> {}

export interface VersionedQuery<
  V extends Versions,
  T extends string,
  Order extends readonly (keyof V & string)[]
> extends TRPCQueryProcedure<{
    input: V[keyof V]["input"];
    output: Extract<V[T & keyof V], { output: unknown }>["output"];
    meta: { versions: V; terminalVersions: T; order: Order };
  }> {}
