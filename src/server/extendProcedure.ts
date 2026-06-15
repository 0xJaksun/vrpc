import type { initTRPC } from "@trpc/server";
import { withVersioning } from "./withVersioning";

type AnyProcedureBuilder = ReturnType<(typeof initTRPC)["create"]>["procedure"];

/** The `.version` method (and its overloads) that vRPC adds. We derive it
 *  from `withVersioning`'s return so there's a single source of truth. */
type VersionMethod = ReturnType<typeof withVersioning>["version"];

/** A procedure that exposes ALL native tRPC methods AND vRPC's `.version()`.
 *  Native methods re-wrap their result so `.version()` stays available
 *  through any chain that doesn't go versioned (e.g. `.use(auth).version(...)`).
 *  Once `.version()` is called, the chain becomes a `VersionedBuilder` and
 *  vanilla tRPC methods are no longer exposed (one path or the other). */
export type ExtendedProcedure<P> = { version: VersionMethod } & {
  [K in keyof P]: P[K] extends (...args: infer A) => infer R
    ? R extends { meta: (...args: never) => unknown }
      ? K extends "input" | "output"
        ? // Once .input() or .output() is called, we've committed to vanilla
          // tRPC. Drop .version from subsequent steps so the two paths can't mix.
          (...args: A) => R
        : (...args: A) => ExtendedProcedure<R>
      : P[K]
    : P[K];
};

/** Extend a tRPC procedure builder with a `.version()` method while preserving
 *  every native tRPC method. Native methods that return another builder are
 *  re-wrapped so `.version()` stays available across the chain.
 *
 *  Usage:
 *  ```ts
 *  const publicProcedure = extendProcedure(t.procedure);
 *
 *  // Vanilla tRPC works:
 *  publicProcedure.input(z.object({})).query(() => "ok");
 *
 *  // Versioned works:
 *  publicProcedure.version("v1", { input, output }).mutation(...);
 *
 *  // Compose middleware with versioning:
 *  publicProcedure.use(authMiddleware).version("v1", { input, output }).mutation(...);
 *  ```
 */
export function extendProcedure<P extends AnyProcedureBuilder>(
  procedure: P,
): ExtendedProcedure<P> {
  return new Proxy(procedure, {
    get(target, prop, receiver) {
      // Intercept .version → vRPC's typed chain entry.
      if (prop === "version") {
        return withVersioning(target as AnyProcedureBuilder).version;
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      // Wrap callable members so the result keeps .version when it's a builder.
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(
          target,
          args,
        );
        if (
          result !== null &&
          typeof result === "object" &&
          "meta" in result &&
          typeof (result as { meta: unknown }).meta === "function"
        ) {
          return extendProcedure(result as AnyProcedureBuilder);
        }
        return result;
      };
    },
  }) as ExtendedProcedure<P>;
}
