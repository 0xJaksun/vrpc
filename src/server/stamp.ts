import type { z } from "zod";

/** Runtime shape passed to `.version()`. */
export type Spec = {
  input: z.ZodType;
  output?: z.ZodType;
  up?: (oldInput: unknown) => unknown;
};

/** Tag a spec with `kind` so the resolver can discriminate walkers vs terminals. */
export function stamp(spec: Spec) {
  return spec.up
    ? { kind: "walker" as const, input: spec.input, up: spec.up }
    : { kind: "terminal" as const, input: spec.input, output: spec.output };
}
