/**
 * Rewrite procedure / router types for a single pinned version.
 *
 * For each versioned procedure, narrow its input to the pinned version's input
 * and its output to whatever the resolver walks to. Non-versioned procedures
 * pass through untouched.
 */
import type {
  AnyRouter,
  AnyProcedure,
  AnyMutationProcedure,
  AnyQueryProcedure,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
  TRPCBuiltRouter,
} from "@trpc/server";
import type { Meta, VersionsOf } from "./meta.type";
import type { WalkOutput } from "./walk.type";

/** Build a retyped procedure of the same kind (mutation/query) with new I/O. */
type Retyped<P extends AnyProcedure, I, O> = P extends AnyMutationProcedure
  ? TRPCMutationProcedure<{ input: I; output: O; meta: P["meta"] }>
  : P extends AnyQueryProcedure
  ? TRPCQueryProcedure<{ input: I; output: O; meta: P["meta"] }>
  : P;

/** Rewrite a versioned procedure for the given pin. */
type RetypeProcedure<
  P extends AnyProcedure,
  Pin extends string
> = VersionsOf<P> extends Meta<infer V, infer O>
  ? Extract<Pin, keyof V> extends infer K extends keyof V
    ? V[K] extends { input: infer I }
      ? Retyped<P, I, WalkOutput<V, O, K>>
      : P
    : P
  : P;

/** Walk a router record; rewrite versioned procedures, recurse into sub-records. */
type RetypeRecord<R, Pin extends string> = {
  [K in keyof R]: R[K] extends AnyProcedure
    ? RetypeProcedure<R[K], Pin>
    : RetypeRecord<R[K], Pin>;
};

/** Router type retyped for a single pin. */
export type PinRouter<
  TRouter extends AnyRouter,
  P extends string
> = TRPCBuiltRouter<
  TRouter["_def"]["_config"]["$types"],
  RetypeRecord<TRouter["_def"]["record"], P>
>;
