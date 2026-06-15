import type {
  initTRPC,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
} from "@trpc/server";
import type { z } from "zod";

type AnyProcedureBuilder = ReturnType<(typeof initTRPC)["create"]>["procedure"];

/** Shape passed to `VersionedMutation` / `VersionedQuery`:
 *  - `versions`: each version's declared shape. Walkers have `{ input }`,
 *    terminals have `{ input, output }`.
 *  - `terminalVersions`: union of terminal version names.
 */
export interface VersionedConfig {
  versions: Record<
    string,
    { input: unknown } | { input: unknown; output: unknown }
  >;
  terminalVersions: string;
}

/** A versioned mutation. Backed by tRPC's publicly re-exported
 *  `TRPCMutationProcedure` so we never reference unstable internals. */
export interface VersionedMutation<Config extends VersionedConfig>
  extends TRPCMutationProcedure<{
    input: Config["versions"][keyof Config["versions"]]["input"];
    output: Extract<
      Config["versions"][Config["terminalVersions"] & keyof Config["versions"]],
      { output: unknown }
    >["output"];
    meta: {
      versions: Config["versions"];
      terminalVersions: Config["terminalVersions"];
    };
  }> {}

/** A versioned query. */
export interface VersionedQuery<Config extends VersionedConfig>
  extends TRPCQueryProcedure<{
    input: Config["versions"][keyof Config["versions"]]["input"];
    output: Extract<
      Config["versions"][Config["terminalVersions"] & keyof Config["versions"]],
      { output: unknown }
    >["output"];
    meta: {
      versions: Config["versions"];
      terminalVersions: Config["terminalVersions"];
    };
  }> {}

/** Walker spec — has `up`, NO `output`. Walks input forward one hop.
 *  `up`'s return type is `NextInput` so the chain is enforced statically. */
type WalkerSpec<I extends z.ZodType, NextInput = unknown> = {
  input: I;
  up: (oldInput: z.infer<I>) => NextInput;
  output?: never;
};

/** Terminal spec — has `output`, NO `up`. Handler delivers this output. */
type TerminalSpec<I extends z.ZodType, O extends z.ZodType> = {
  input: I;
  output: O;
  up?: never;
};

/** Flatten intersection chains into a single clean record for hover display. */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Discriminated `{ input, version }` union over terminal versions. */
type HandlerArgs<
  Versions extends Record<string, { input: unknown }>,
  TerminalNames extends string
> = {
  [K in TerminalNames & keyof Versions]: {
    input: Versions[K]["input"];
    version: K;
  };
}[TerminalNames & keyof Versions];

/** A builder that has at least one terminal — can finalize via mutation/query.
 *  Adding a walker tightens the next `.version()` call's input via NextInput. */
type TerminalBuilder<
  Versions extends Record<string, { input: unknown }>,
  TerminalNames extends string,
  O extends z.ZodType,
> = {
  // Add a walker: stays a TerminalBuilder; next call's input must match
  // the walker's `up` return type.
  version<N extends string, I2 extends z.ZodType, NextInput>(
    name: N,
    spec: WalkerSpec<I2, NextInput>,
  ): WalkerPendingBuilder<
    Versions & { [K in N]: { input: z.infer<I2> } },
    TerminalNames,
    O,
    NextInput
  >;
  // Add a terminal: stays a TerminalBuilder, latest output rebinds.
  version<N extends string, I2 extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: TerminalSpec<I2, O2>,
  ): TerminalBuilder<
    Versions & { [K in N]: { input: z.infer<I2>; output: z.infer<O2> } },
    TerminalNames | N,
    O2
  >;
  mutation(
    handler: (
      args: HandlerArgs<Versions, TerminalNames>
    ) => z.infer<O> | Promise<z.infer<O>>
  ): VersionedMutation<{
    versions: Prettify<Versions>;
    terminalVersions: TerminalNames;
  }>;
  query(
    handler: (
      args: HandlerArgs<Versions, TerminalNames>
    ) => z.infer<O> | Promise<z.infer<O>>
  ): VersionedQuery<{
    versions: Prettify<Versions>;
    terminalVersions: TerminalNames;
  }>;
};

/** Builder state where a walker has been added but the chain hasn't reached
 *  a terminal yet. Next `.version()` call's input MUST match the previous
 *  walker's `up` return type (`NextInput`). */
type WalkerPendingBuilder<
  Versions extends Record<string, { input: unknown }>,
  TerminalNames extends string,
  O extends z.ZodType,
  NextInput,
> = {
  // Add a walker. Previous walker's `up` return (NextInput) must satisfy
  // this version's declared input shape.
  version<
    N extends string,
    I2 extends z.ZodType,
    NextNext,
  >(
    name: N,
    spec: NextInput extends z.input<I2>
      ? WalkerSpec<I2, NextNext>
      : { _error: "up's return type does not match this version's input"; expected: z.input<I2>; got: NextInput },
  ): WalkerPendingBuilder<
    Versions & { [K in N]: { input: z.infer<I2> } },
    TerminalNames,
    O,
    NextNext
  >;
  // Add a terminal. Previous walker's `up` return (NextInput) must satisfy
  // this version's declared input shape.
  version<
    N extends string,
    I2 extends z.ZodType,
    O2 extends z.ZodType,
  >(
    name: N,
    spec: NextInput extends z.input<I2>
      ? TerminalSpec<I2, O2>
      : { _error: "up's return type does not match this version's input"; expected: z.input<I2>; got: NextInput },
  ): TerminalBuilder<
    Versions & { [K in N]: { input: z.infer<I2>; output: z.infer<O2> } },
    [TerminalNames] extends [never] ? N : TerminalNames | N,
    O2
  >;
};

export function withVersioning(procedure: AnyProcedureBuilder): {
  // First version is a walker → pending, next call's input must match `up`'s return.
  version<N extends string, I extends z.ZodType, NextInput>(
    name: N,
    spec: WalkerSpec<I, NextInput>,
  ): WalkerPendingBuilder<
    { [K in N]: { input: z.infer<I> } },
    never,
    z.ZodType,
    NextInput
  >;
  // First version is a terminal → can finalize immediately.
  version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: TerminalSpec<I, O>,
  ): TerminalBuilder<
    { [K in N]: { input: z.infer<I>; output: z.infer<O> } },
    N,
    O
  >;
} {
  // Recursive builder: tRPC's procedure (input/output bound to latest terminal,
  // full version map attached as meta) extended with a chainable `.version`.
  // `latestOutput` is the most recent terminal's output schema (for tRPC binding).
  function build(
    versions: Record<string, unknown>,
    latestInput: z.ZodType,
    latestOutput: z.ZodType | null
  ) {
    // If no terminal yet, fall back to z.unknown() for the output binding.
    // (The runtime won't enforce output anyway until a terminal closes the chain.)
    const built = procedure
      .input(latestInput)
      .output(latestOutput ?? (latestInput as never))
      .meta({ _vrpcVersions: versions });

    const version = (
      name: string,
      spec: { input: z.ZodType; output?: z.ZodType; up?: unknown }
    ) =>
      build(
        { ...versions, [name]: spec },
        spec.input,
        spec.output ?? latestOutput
      );

    return Object.assign(built, { version });
  }

  function version<N extends string, I extends z.ZodType, NextInput>(
    name: N,
    spec: WalkerSpec<I, NextInput>,
  ): WalkerPendingBuilder<
    { [K in N]: { input: z.infer<I> } },
    never,
    z.ZodType,
    NextInput
  >;
  function version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: TerminalSpec<I, O>,
  ): TerminalBuilder<
    { [K in N]: { input: z.infer<I>; output: z.infer<O> } },
    N,
    O
  >;
  function version(
    name: string,
    spec: { input: z.ZodType; output?: z.ZodType; up?: unknown }
  ): unknown {
    return build({ [name]: spec }, spec.input, spec.output ?? null);
  }

  return { version };
}
