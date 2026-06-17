/**
 * Chain builder types for `.version().version()...mutation/query()`.
 *
 * - `TerminalBuilder` — has ≥1 terminal; can finalize via `.mutation`/`.query`.
 * - `WalkerPendingBuilder` — last `.version()` was a walker; next call's input
 *   MUST satisfy that walker's `up` return type (enforced via `ChainMismatch`).
 */
import type { z } from "zod";
import type { WalkerSpec, TerminalSpec, ChainMismatch } from "./specs.type";
import type { Handlers } from "./handlers.type";
import type { VersionedMutation, VersionedQuery } from "./procedures.type";

type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Has ≥1 terminal — can finalize. */
export type TerminalBuilder<
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
  mutation(handlers: Handlers<V, T>): VersionedMutation<Prettify<V>, T, Order>;
  query(handlers: Handlers<V, T>): VersionedQuery<Prettify<V>, T, Order>;
};

/** Pending walker — next `.version()` input MUST satisfy `NextInput`. */
export type WalkerPendingBuilder<
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
