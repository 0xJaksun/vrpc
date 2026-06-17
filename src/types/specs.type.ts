/**
 * Spec shapes passed to `.version()`.
 *
 * A walker declares `input` + `up` (transforms input forward one hop).
 * A terminal declares `input` + `output` (handler delivers `output`).
 * `ChainMismatch` is surfaced when a walker's `up` output doesn't match
 * the next version's input.
 */
import type { z } from "zod";

/** Walker: declares `input` + `up`. No `output`. Walks input forward one hop. */
export type WalkerSpec<I extends z.ZodType, NextInput = unknown> = {
  input: I;
  up: (oldInput: z.infer<I>) => NextInput;
  output?: never;
};

/** Terminal: declares `input` + `output`. No `up`. Handler delivers `output`. */
export type TerminalSpec<I extends z.ZodType, O extends z.ZodType> = {
  input: I;
  output: O;
  up?: never;
};

/** Surfaces a typed error when a walker's `up` return type doesn't match the next input. */
export type ChainMismatch<Expected, Got> = {
  _error: "up's return type does not match next version's input";
  expected: Expected;
  got: Got;
};
