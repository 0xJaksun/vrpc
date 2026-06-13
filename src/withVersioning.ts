import type { initTRPC } from "@trpc/server";
import type { z } from "zod";

type AnyProcedureBuilder = ReturnType<(typeof initTRPC)["create"]>["procedure"];

type VersionSpec<I extends z.ZodType, O extends z.ZodType> = {
  input: I;
  output: O;
  up?: (oldInput: z.infer<I>) => unknown;
};

// Discriminated handler args: input and version pair up so TS narrows
// `input` when the user switches on `version`.
type HandlerArgs<Terminals extends Record<string, unknown>> = {
  [K in keyof Terminals & string]: {
    input: Terminals[K];
    version: K;
  };
}[keyof Terminals & string];

type VersionedBuilder<
  Terminals extends Record<string, unknown>,
  O extends z.ZodType
> = {
  // Overload 1: spec has `up` → non-terminal, NOT added to Terminals.
  version<N extends string, I2 extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: {
      input: I2;
      output: O2;
      up: (oldInput: z.infer<I2>) => unknown;
    }
  ): VersionedBuilder<Terminals, O2>;
  // Overload 2: spec has no `up` → terminal, added to Terminals.
  version<N extends string, I2 extends z.ZodType, O2 extends z.ZodType>(
    name: N,
    spec: { input: I2; output: O2 }
  ): VersionedBuilder<Terminals & { [K in N]: z.infer<I2> }, O2>;
  mutation(
    handler: (args: HandlerArgs<Terminals>) => z.infer<O> | Promise<z.infer<O>>
  ): unknown;
  query(
    handler: (args: HandlerArgs<Terminals>) => z.infer<O> | Promise<z.infer<O>>
  ): unknown;
};

export function withVersioning(procedure: AnyProcedureBuilder): {
  // Overload 1: spec has `up` → non-terminal.
  version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O; up: (oldInput: z.infer<I>) => unknown }
    // eslint-disable-next-line @typescript-eslint/ban-types
  ): VersionedBuilder<{}, O>;
  // Overload 2: spec has no `up` → terminal.
  version<N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: { input: I; output: O }
  ): VersionedBuilder<{ [K in N]: z.infer<I> }, O>;
} {
  function build<I extends z.ZodType, O extends z.ZodType>(
    versions: Record<string, unknown>,
    latest: VersionSpec<I, O>
  ) {
    const built = procedure
      .input(latest.input)
      .output(latest.output)
      .meta({ _vrpcVersions: versions });

    const versionFn = <
      N extends string,
      S extends VersionSpec<z.ZodType, z.ZodType>
    >(
      name: N,
      spec: S
    ) => {
      const nextVersions = { ...versions, [name]: spec };
      return build(nextVersions, spec);
    };

    return Object.assign(built, { version: versionFn });
  }

  function publicVersion<
    N extends string,
    I extends z.ZodType,
    O extends z.ZodType
  >(
    name: N,
    spec: { input: I; output: O; up: (oldInput: z.infer<I>) => unknown }
    // eslint-disable-next-line @typescript-eslint/ban-types
  ): VersionedBuilder<{}, O>;
  function publicVersion<
    N extends string,
    I extends z.ZodType,
    O extends z.ZodType
  >(
    name: N,
    spec: { input: I; output: O }
  ): VersionedBuilder<{ [K in N]: z.infer<I> }, O>;
  function publicVersion(
    name: string,
    spec: VersionSpec<z.ZodType, z.ZodType>
  ): unknown {
    return build({ [name]: spec }, spec);
  }

  return { version: publicVersion };
}
