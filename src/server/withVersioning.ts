import type {
  initTRPC,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
} from "@trpc/server";
import { z } from "zod";
import { resolveVersionedRequest } from "./middleware";

type AnyT = ReturnType<(typeof initTRPC)["create"]>;

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
  T extends string,
  Order extends readonly (keyof V & string)[]
> extends TRPCMutationProcedure<{
    input: V[keyof V]["input"];
    output: Extract<V[T & keyof V], { output: unknown }>["output"];
    meta: { versions: V; terminalVersions: T; order: Order };
  }> {}

export interface VersionedQuery<
  V extends Record<
    string,
    { input: unknown } | { input: unknown; output: unknown }
  >,
  T extends string,
  Order extends readonly (keyof V & string)[]
> extends TRPCQueryProcedure<{
    input: V[keyof V]["input"];
    output: Extract<V[T & keyof V], { output: unknown }>["output"];
    meta: { versions: V; terminalVersions: T; order: Order };
  }> {}

/** Has ≥1 terminal — can finalize. */
type TerminalBuilder<
  V extends Record<string, { input: unknown }>,
  T extends string,
  O extends z.ZodType,
  Order extends readonly (keyof V & string)[]
> = {
  version<N extends string, I extends z.ZodType, NextInput>(
    name: N,
    spec: WalkerSpec<I, NextInput>
  ): WalkerPendingBuilder<
    V & { [K in N]: { input: z.infer<I> } },
    T,
    O,
    NextInput,
    readonly [...Order, N]
  >;
  version<N extends string, I extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: TerminalSpec<I, O2>
  ): TerminalBuilder<
    V & { [K in N]: { input: z.infer<I>; output: z.infer<O2> } },
    T | N,
    O2,
    readonly [...Order, N]
  >;
  mutation(
    handlers: Handlers<V, T>
  ): VersionedMutation<Prettify<V>, T, Order>;
  query(handlers: Handlers<V, T>): VersionedQuery<Prettify<V>, T, Order>;
};

/** Pending walker — next `.version()` input MUST satisfy NextInput. */
type WalkerPendingBuilder<
  V extends Record<string, { input: unknown }>,
  T extends string,
  O extends z.ZodType,
  NextInput,
  Order extends readonly (keyof V & string)[]
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
    NextNext,
    readonly [...Order, N]
  >;
  version<N extends string, I extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: NextInput extends z.input<I>
      ? TerminalSpec<I, O2>
      : ChainMismatch<z.input<I>, NextInput>
  ): TerminalBuilder<
    V & { [K in N]: { input: z.infer<I>; output: z.infer<O2> } },
    [T] extends [never] ? N : T | N,
    O2,
    readonly [...Order, N]
  >;
};

export function withVersioning(t: AnyT): AnyT["procedure"] & {
  version<N extends string, I extends z.ZodType, NextInput>(
    name: N,
    spec: WalkerSpec<I, NextInput>
  ): WalkerPendingBuilder<
    { [K in N]: { input: z.infer<I> } },
    never,
    z.ZodType,
    NextInput,
    readonly [N]
  >;
  version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: TerminalSpec<I, O>
  ): TerminalBuilder<
    { [K in N]: { input: z.infer<I>; output: z.infer<O> } },
    N,
    O,
    readonly [N]
  >;
} {
  type Spec = {
    input: z.ZodType;
    output?: z.ZodType;
    up?: (oldInput: unknown) => unknown;
  };

  /** Stamp the spec with `kind` so the runtime can discriminate cleanly. */
  function stamp(spec: Spec): Record<string, unknown> {
    return spec.up
      ? { kind: "walker", input: spec.input, up: spec.up }
      : { kind: "terminal", input: spec.input, output: spec.output };
  }

  function build(versions: Record<string, unknown>, output: z.ZodType | null) {
    const built = t.procedure
      .use(async (opts) => {
        const rawInput = await opts.getRawInput();
        return opts.next(
          resolveVersionedRequest({
            ctx: opts.ctx,
            input: rawInput,
            meta: opts.meta,
          })
        );
      })
      .input(z.unknown())
      .meta({ _vrpcVersions: versions, _vrpcOrder: Object.keys(versions) });

    const version = (name: string, spec: Spec) =>
      build({ ...versions, [name]: stamp(spec) }, spec.output ?? output);

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

    const originalMutation = built.mutation.bind(built);
    const originalQuery = built.query.bind(built);

    const mutation = (handlers: Record<string, (args: unknown) => unknown>) =>
      originalMutation(wrapHandlers(handlers));

    const query = (handlers: Record<string, (args: unknown) => unknown>) =>
      originalQuery(wrapHandlers(handlers));

    return Object.assign(built, { version, mutation, query });
  }

  function version<N extends string, I extends z.ZodType, NextInput>(
    name: N,
    spec: WalkerSpec<I, NextInput>
  ): WalkerPendingBuilder<
    { [K in N]: { input: z.infer<I> } },
    never,
    z.ZodType,
    NextInput,
    readonly [N]
  >;
  function version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: TerminalSpec<I, O>
  ): TerminalBuilder<
    { [K in N]: { input: z.infer<I>; output: z.infer<O> } },
    N,
    O,
    readonly [N]
  >;
  function version(name: string, spec: Spec): unknown {
    return build({ [name]: stamp(spec) }, spec.output ?? null);
  }

  return Object.assign(t.procedure, { version }) as never;
}
