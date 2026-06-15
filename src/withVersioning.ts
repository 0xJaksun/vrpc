import type {
  initTRPC,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
} from "@trpc/server";
import type { z } from "zod";

type AnyProcedureBuilder = ReturnType<(typeof initTRPC)["create"]>["procedure"];

/** Walker: declares `input` + `up`. No `output`. Walks input forward one hop. */
type WalkerSpec<I extends z.ZodType, NextInput = unknown> = {
  input: I;
  up: (oldInput: z.infer<I>) => NextInput;
  output?: never;
};

/** Terminal: declares `input` + `output`. No `up`. Handler delivers `output`. */
type TerminalSpec<I extends z.ZodType, O extends z.ZodType> = {
  input: I;
  output: O;
  up?: never;
};

type ChainMismatch<Expected, Got> = {
  _error: "up's return type does not match next version's input";
  expected: Expected;
  got: Got;
};

type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Per-version handlers map. Each terminal version gets its OWN typed handler:
 *  - `input` is narrowed to that version's input shape
 *  - return type is enforced to be that version's output shape
 *  Strict per-version enforcement at compile time. */
type Handlers<V, T extends string> = {
  [K in T & keyof V]: V[K] extends { input: infer I; output: infer O }
    ? (args: { input: I }) => O | Promise<O>
    : never;
};

export interface VersionedMutation<
  V extends Record<
    string,
    { input: unknown } | { input: unknown; output: unknown }
  >,
  T extends string
> extends TRPCMutationProcedure<{
    input: V[keyof V]["input"];
    output: Extract<V[T & keyof V], { output: unknown }>["output"];
    meta: { versions: V; terminalVersions: T };
  }> {}

export interface VersionedQuery<
  V extends Record<
    string,
    { input: unknown } | { input: unknown; output: unknown }
  >,
  T extends string
> extends TRPCQueryProcedure<{
    input: V[keyof V]["input"];
    output: Extract<V[T & keyof V], { output: unknown }>["output"];
    meta: { versions: V; terminalVersions: T };
  }> {}

/** Has ≥1 terminal — can finalize. */
type TerminalBuilder<
  V extends Record<string, { input: unknown }>,
  T extends string,
  O extends z.ZodType
> = {
  version<N extends string, I extends z.ZodType, NextInput>(
    name: N,
    spec: WalkerSpec<I, NextInput>
  ): WalkerPendingBuilder<
    V & { [K in N]: { input: z.infer<I> } },
    T,
    O,
    NextInput
  >;
  version<N extends string, I extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: TerminalSpec<I, O2>
  ): TerminalBuilder<
    V & { [K in N]: { input: z.infer<I>; output: z.infer<O2> } },
    T | N,
    O2
  >;
  mutation(handlers: Handlers<V, T>): VersionedMutation<Prettify<V>, T>;
  query(handlers: Handlers<V, T>): VersionedQuery<Prettify<V>, T>;
};

/** Pending walker — next `.version()` input MUST satisfy NextInput. */
type WalkerPendingBuilder<
  V extends Record<string, { input: unknown }>,
  T extends string,
  O extends z.ZodType,
  NextInput
> = {
  version<N extends string, I extends z.ZodType, NextNext>(
    name: N,
    spec: NextInput extends z.input<I>
      ? WalkerSpec<I, NextNext>
      : ChainMismatch<z.input<I>, NextInput>
  ): WalkerPendingBuilder<
    V & { [K in N]: { input: z.infer<I> } },
    T,
    O,
    NextNext
  >;
  version<N extends string, I extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: NextInput extends z.input<I>
      ? TerminalSpec<I, O2>
      : ChainMismatch<z.input<I>, NextInput>
  ): TerminalBuilder<
    V & { [K in N]: { input: z.infer<I>; output: z.infer<O2> } },
    [T] extends [never] ? N : T | N,
    O2
  >;
};

export function withVersioning(procedure: AnyProcedureBuilder): {
  version<N extends string, I extends z.ZodType, NextInput>(
    name: N,
    spec: WalkerSpec<I, NextInput>
  ): WalkerPendingBuilder<
    { [K in N]: { input: z.infer<I> } },
    never,
    z.ZodType,
    NextInput
  >;
  version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: TerminalSpec<I, O>
  ): TerminalBuilder<
    { [K in N]: { input: z.infer<I>; output: z.infer<O> } },
    N,
    O
  >;
} {
  type Spec = { input: z.ZodType; output?: z.ZodType; up?: unknown };

  function build(
    versions: Record<string, unknown>,
    input: z.ZodType,
    output: z.ZodType | null
  ) {
    const built = procedure
      .input(input)
      .output(output ?? (input as never))
      .meta({ _vrpcVersions: versions });

    const version = (name: string, spec: Spec) =>
      build({ ...versions, [name]: spec }, spec.input, spec.output ?? output);

    // Wrap .mutation / .query so they accept a per-version handlers map and
    // dispatch on the resolved terminal version (set by middleware on ctx).
    const wrapHandlers =
      (handlers: Record<string, (args: unknown) => unknown>) =>
      (opts: { input: unknown; ctx: Record<string, unknown> }) => {
        const resolved = opts.ctx["_vrpcVersion"] as string | undefined;
        const handler = resolved ? handlers[resolved] : undefined;
        if (!handler) {
          throw new Error(
            `vrpc: no handler registered for resolved version "${
              resolved ?? "unknown"
            }"`
          );
        }
        return handler({ input: opts.input });
      };

    const mutation = (handlers: Record<string, (args: unknown) => unknown>) =>
      built.mutation(wrapHandlers(handlers));

    const query = (handlers: Record<string, (args: unknown) => unknown>) =>
      built.query(wrapHandlers(handlers));

    return Object.assign(built, { version, mutation, query });
  }

  function version<N extends string, I extends z.ZodType, NextInput>(
    name: N,
    spec: WalkerSpec<I, NextInput>
  ): WalkerPendingBuilder<
    { [K in N]: { input: z.infer<I> } },
    never,
    z.ZodType,
    NextInput
  >;
  function version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: TerminalSpec<I, O>
  ): TerminalBuilder<
    { [K in N]: { input: z.infer<I>; output: z.infer<O> } },
    N,
    O
  >;
  function version(name: string, spec: Spec): unknown {
    return build({ [name]: spec }, spec.input, spec.output ?? null);
  }

  return { version };
}
