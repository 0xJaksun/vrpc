/**
 * Read versioning metadata off tRPC procedures.
 *
 * Each versioned procedure carries `{ versions, order }` in its meta.
 * These helpers extract it, list every declared version name, and define
 * the "valid pin" type for a router.
 */
import type { AnyRouter, AnyProcedure } from "@trpc/server";

/** Shape of meta on a versioned procedure. */
export type Meta<V, O> = { versions: V; order: O };

/** Extract `{ versions, order }` off a procedure's meta, or `never`. */
export type VersionsOf<P> = P extends AnyProcedure
  ? P["meta"] extends Meta<infer V, infer O>
    ? V extends Record<string, unknown>
      ? O extends readonly (keyof V & string)[]
        ? Meta<V, O>
        : never
      : never
    : never
  : never;

/** Union of every declared version name across the router. */
type AllVersions<R> = {
  [K in keyof R]: R[K] extends AnyProcedure
    ? VersionsOf<R[K]> extends Meta<infer V, infer _>
      ? keyof V & string
      : never
    : R[K] extends Record<string, unknown>
    ? AllVersions<R[K]>
    : never;
}[keyof R];

/** Valid pin values for a given router. */
export type Pin<TRouter extends AnyRouter> = AllVersions<
  TRouter["_def"]["record"]
>;
