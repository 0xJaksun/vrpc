/**
 * Walk the declared version order forward from a pin.
 *
 * Given the version map `V`, declaration order `Order`, and a pinned version
 * name `Pin`, returns the output type of the first version at-or-after `Pin`
 * that declares an `output` field.
 */

/** Walk `Order` from `Pin` forward; return the first version's output. */
export type WalkOutput<V, Order, Pin> = Order extends readonly [
  infer Head,
  ...infer Rest
]
  ? [Head] extends [Pin]
    ? FirstOutput<V, readonly [Head, ...Extract<Rest, readonly unknown[]>]>
    : WalkOutput<V, Rest, Pin>
  : never;

/** First version with an `output` field, walking the tuple in order. */
type FirstOutput<V, Order> = Order extends readonly [infer Head, ...infer Rest]
  ? Head extends keyof V
    ? V[Head] extends { output: infer O }
      ? O
      : FirstOutput<V, Rest>
    : never
  : never;
