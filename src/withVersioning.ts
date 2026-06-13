import type {
  initTRPC,
  TRPCMutationProcedure,
  TRPCQueryProcedure,
} from "@trpc/server";
import type { z } from "zod";

type AnyProcedureBuilder = ReturnType<(typeof initTRPC)["create"]>["procedure"];

/** Shape passed to `VersionedMutation` / `VersionedQuery`:
 *  - `inputs`: every ACCEPTED version's input shape (clients can pin to any)
 *  - `outputs`: every TERMINAL version's output shape
 *  - `terminalVersions`: union of terminal version names
 */
export interface VersionedConfig {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  terminalVersions: string;
}

/** A versioned mutation. Backed by tRPC's publicly re-exported
 *  `TRPCMutationProcedure` so we never reference unstable internals. */
export interface VersionedMutation<Config extends VersionedConfig>
  extends TRPCMutationProcedure<{
    input: Config["inputs"][keyof Config["inputs"]];
    output: Config["outputs"][keyof Config["outputs"]];
    meta: {
      inputs: Config["inputs"];
      outputs: Config["outputs"];
      terminalVersions: Config["terminalVersions"];
    };
  }> {}

/** A versioned query. */
export interface VersionedQuery<Config extends VersionedConfig>
  extends TRPCQueryProcedure<{
    input: Config["inputs"][keyof Config["inputs"]];
    output: Config["outputs"][keyof Config["outputs"]];
    meta: {
      inputs: Config["inputs"];
      outputs: Config["outputs"];
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
type HandlerArgs<Terminals extends Record<string, unknown>> = {
  [K in keyof Terminals & string]: { input: Terminals[K]; version: K };
}[keyof Terminals & string];

type VersionedBuilder<
  Accepted extends Record<string, unknown>,
  Terminals extends Record<string, unknown>,
  TerminalOutputs extends Record<string, unknown>,
  O extends z.ZodType
> = {
  // With `up` → non-terminal: added to Accepted only.
  version<N extends string, I2 extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: { input: I2; output: O2; up: (oldInput: z.infer<I2>) => unknown }
  ): VersionedBuilder<
    Accepted & { [K in N]: z.infer<I2> },
    Terminals,
    TerminalOutputs,
    O2
  >;
  // No `up` → terminal: added to Accepted, Terminals, and TerminalOutputs.
  version<N extends string, I2 extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: { input: I2; output: O2 }
  ): VersionedBuilder<
    Accepted & { [K in N]: z.infer<I2> },
    Terminals & { [K in N]: z.infer<I2> },
    TerminalOutputs & { [K in N]: z.infer<O2> },
    O2
  >;
  mutation(
    handler: (args: HandlerArgs<Terminals>) => z.infer<O> | Promise<z.infer<O>>
  ): VersionedMutation<{
    inputs: Prettify<Accepted>;
    outputs: Prettify<TerminalOutputs>;
    terminalVersions: keyof Terminals & string;
  }>;
  query(
    handler: (args: HandlerArgs<Terminals>) => z.infer<O> | Promise<z.infer<O>>
  ): VersionedQuery<{
    inputs: Prettify<Accepted>;
    outputs: Prettify<TerminalOutputs>;
    terminalVersions: keyof Terminals & string;
  }>;
};

export function withVersioning(procedure: AnyProcedureBuilder): {
  version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O; up: (oldInput: z.infer<I>) => unknown }
  ): VersionedBuilder<
    { [K in N]: z.infer<I> },
    // eslint-disable-next-line @typescript-eslint/ban-types
    {},
    // eslint-disable-next-line @typescript-eslint/ban-types
    {},
    O
  >;
  version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O }
  ): VersionedBuilder<
    { [K in N]: z.infer<I> },
    { [K in N]: z.infer<I> },
    { [K in N]: z.infer<O> },
    O
  >;
} {
  // Recursive builder: tRPC's procedure (input/output bound to latest,
  // full version map attached as meta) extended with a chainable `.version`.
  function build<I extends z.ZodType, O extends z.ZodType>(
    versions: Record<string, unknown>,
    latest: VersionSpec<I, O>
  ) {
    const built = procedure
      .input(latest.input)
      .output(latest.output)
      .meta({ _vrpcVersions: versions });

    const version = <
      N extends string,
      S extends VersionSpec<z.ZodType, z.ZodType>
    >(
      name: N,
      spec: S
    ) => build({ ...versions, [name]: spec }, spec);

    return Object.assign(built, { version });
  }

  function version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O; up: (oldInput: z.infer<I>) => unknown }
  ): VersionedBuilder<{ [K in N]: z.infer<I> }, {}, {}, O>;
  function version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O }
  ): VersionedBuilder<
    { [K in N]: z.infer<I> },
    { [K in N]: z.infer<I> },
    { [K in N]: z.infer<O> },
    O
  >;
  function version(
    name: string,
    spec: VersionSpec<z.ZodType, z.ZodType>
  ): unknown {
    return build({ [name]: spec }, spec);
  }

  return { version };
}
