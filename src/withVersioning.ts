import type { initTRPC } from "@trpc/server";
import type { z } from "zod";

type AnyProcedureBuilder = ReturnType<(typeof initTRPC)["create"]>["procedure"];

/** A single version layer: input/output schemas + optional `up` transformer
 *  that walks one hop forward. No `up` = terminal (handler receives this shape). */
type VersionSpec<I extends z.ZodType, O extends z.ZodType> = {
  input: I;
  output: O;
  up?: (oldInput: z.infer<I>) => unknown;
};

/** Discriminated `{ input, version }` union over terminal versions. */
type HandlerArgs<Terminals extends Record<string, unknown>> = {
  [K in keyof Terminals & string]: { input: Terminals[K]; version: K };
}[keyof Terminals & string];

type VersionedBuilder<
  Terminals extends Record<string, unknown>,
  O extends z.ZodType
> = {
  // With `up` → non-terminal, NOT added to Terminals.
  version<N extends string, I extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: { input: I; output: O2; up: (oldInput: z.infer<I>) => unknown }
  ): VersionedBuilder<Terminals, O2>;
  // No `up` → terminal, added to Terminals.
  version<N extends string, I extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: { input: I; output: O2 }
  ): VersionedBuilder<Terminals & { [K in N]: z.infer<I> }, O2>;
  mutation(
    handler: (args: HandlerArgs<Terminals>) => z.infer<O> | Promise<z.infer<O>>
  ): unknown;
  query(
    handler: (args: HandlerArgs<Terminals>) => z.infer<O> | Promise<z.infer<O>>
  ): unknown;
};

export function withVersioning(procedure: AnyProcedureBuilder): {
  version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O; up: (oldInput: z.infer<I>) => unknown }
  ): VersionedBuilder<{}, O>;
  version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O }
  ): VersionedBuilder<{ [K in N]: z.infer<I> }, O>;
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
    // eslint-disable-next-line @typescript-eslint/ban-types
  ): VersionedBuilder<{}, O>;
  function version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O }
  ): VersionedBuilder<{ [K in N]: z.infer<I> }, O>;
  function version(
    name: string,
    spec: VersionSpec<z.ZodType, z.ZodType>
  ): unknown {
    return build({ [name]: spec }, spec);
  }

  return { version };
}
