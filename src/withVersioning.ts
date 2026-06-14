import type {
  initTRPC,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
} from "@trpc/server";
import type { z } from "zod";

type AnyProcedureBuilder = ReturnType<(typeof initTRPC)["create"]>["procedure"];

/** Shape passed to `VersionedMutation` / `VersionedQuery`:
 *  - `versions`: each version's declared input + output (terminal entries
 *    deliver this output; non-terminal entries declare what they wanted).
 *  - `terminalVersions`: union of version names the handler discriminates on.
 */
export interface VersionedConfig {
  versions: Record<string, { input: unknown; output: unknown }>;
  terminalVersions: string;
}

/** A versioned mutation. Backed by tRPC's publicly re-exported
 *  `TRPCMutationProcedure` so we never reference unstable internals. */
export interface VersionedMutation<Config extends VersionedConfig>
  extends TRPCMutationProcedure<{
    input: Config["versions"][keyof Config["versions"]]["input"];
    output: Config["versions"][Config["terminalVersions"] &
      keyof Config["versions"]]["output"];
    meta: {
      versions: Config["versions"];
      terminalVersions: Config["terminalVersions"];
    };
  }> {}

/** A versioned query. */
export interface VersionedQuery<Config extends VersionedConfig>
  extends TRPCQueryProcedure<{
    input: Config["versions"][keyof Config["versions"]]["input"];
    output: Config["versions"][Config["terminalVersions"] &
      keyof Config["versions"]]["output"];
    meta: {
      versions: Config["versions"];
      terminalVersions: Config["terminalVersions"];
    };
  }> {}

/** A single version layer: input/output schemas + optional `up` transformer
 *  that walks one hop forward. No `up` = terminal (handler receives this shape). */
type VersionSpec<I extends z.ZodType, O extends z.ZodType> = {
  input: I;
  output: O;
  up?: (oldInput: z.infer<I>) => unknown;
};

/** Flatten intersection chains into a single clean record for hover display. */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Discriminated `{ input, version }` union over terminal versions. */
type HandlerArgs<
  Versions extends Record<string, { input: unknown; output: unknown }>,
  TerminalNames extends string,
> = {
  [K in TerminalNames & keyof Versions]: {
    input: Versions[K]["input"];
    version: K;
  };
}[TerminalNames & keyof Versions];

type VersionedBuilder<
  Versions extends Record<string, { input: unknown; output: unknown }>,
  TerminalNames extends string,
  O extends z.ZodType,
> = {
  // With `up` → non-terminal: added to Versions only.
  version<N extends string, I2 extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: { input: I2; output: O2; up: (oldInput: z.infer<I2>) => unknown },
  ): VersionedBuilder<
    Versions & { [K in N]: { input: z.infer<I2>; output: z.infer<O2> } },
    TerminalNames,
    O2
  >;
  // No `up` → terminal: added to Versions and TerminalNames.
  version<N extends string, I2 extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: { input: I2; output: O2 },
  ): VersionedBuilder<
    Versions & { [K in N]: { input: z.infer<I2>; output: z.infer<O2> } },
    TerminalNames | N,
    O2
  >;
  mutation(
    handler: (
      args: HandlerArgs<Versions, TerminalNames>,
    ) => z.infer<O> | Promise<z.infer<O>>,
  ): VersionedMutation<{
    versions: Prettify<Versions>;
    terminalVersions: TerminalNames;
  }>;
  query(
    handler: (
      args: HandlerArgs<Versions, TerminalNames>,
    ) => z.infer<O> | Promise<z.infer<O>>,
  ): VersionedQuery<{
    versions: Prettify<Versions>;
    terminalVersions: TerminalNames;
  }>;
};

export function withVersioning(procedure: AnyProcedureBuilder): {
  version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O; up: (oldInput: z.infer<I>) => unknown },
  ): VersionedBuilder<
    { [K in N]: { input: z.infer<I>; output: z.infer<O> } },
    never,
    O
  >;
  version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O },
  ): VersionedBuilder<
    { [K in N]: { input: z.infer<I>; output: z.infer<O> } },
    N,
    O
  >;
} {
  // Recursive builder: tRPC's procedure (input/output bound to latest,
  // full version map attached as meta) extended with a chainable `.version`.
  function build<I extends z.ZodType, O extends z.ZodType>(
    versions: Record<string, unknown>,
    latest: VersionSpec<I, O>,
  ) {
    const built = procedure
      .input(latest.input)
      .output(latest.output)
      .meta({ _vrpcVersions: versions });

    const version = <
      N extends string,
      S extends VersionSpec<z.ZodType, z.ZodType>,
    >(name: N, spec: S) => build({ ...versions, [name]: spec }, spec);

    return Object.assign(built, { version });
  }

  function version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O; up: (oldInput: z.infer<I>) => unknown },
  ): VersionedBuilder<
    { [K in N]: { input: z.infer<I>; output: z.infer<O> } },
    never,
    O
  >;
  function version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O },
  ): VersionedBuilder<
    { [K in N]: { input: z.infer<I>; output: z.infer<O> } },
    N,
    O
  >;
  function version(
    name: string,
    spec: VersionSpec<z.ZodType, z.ZodType>,
  ): unknown {
    return build({ [name]: spec }, spec);
  }

  return { version };
}
