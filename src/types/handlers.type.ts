/**
 * Per-version handler maps passed to `.mutation()` / `.query()`.
 *
 * Each terminal version gets its OWN typed handler:
 *  - `input` is narrowed to that version's input shape.
 *  - return type is enforced to be that version's output shape.
 */

export type Handlers<V, T extends string> = {
  [K in T & keyof V]: V[K] extends { input: infer I; output: infer O }
    ? (args: { input: I }) => O | Promise<O>
    : never;
};
