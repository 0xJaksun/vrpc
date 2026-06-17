import type { initTRPC } from "@trpc/server";
import { z } from "zod";
import { resolveVersionedRequest } from "./middleware";
import { stamp, type Spec } from "./stamp";
import { dispatch } from "./dispatch";
import type {
  WalkerSpec,
  TerminalSpec,
  TerminalBuilder,
  WalkerPendingBuilder,
} from "../types";

type AnyT = ReturnType<(typeof initTRPC)["create"]>;

/** The `.version()` overload — used as both factory and builder method. */
type VersionFn = {
  <N extends string, I extends z.ZodType, NextInput>(
    name: N,
    spec: WalkerSpec<I, NextInput>
  ): WalkerPendingBuilder<
    { [K in N]: { input: z.infer<I> } },
    never,
    z.ZodType,
    NextInput,
    readonly [N]
  >;
  <N extends string, I extends z.ZodType, O extends z.ZodType>(
    name: N,
    spec: TerminalSpec<I, O>
  ): TerminalBuilder<
    { [K in N]: { input: z.infer<I>; output: z.infer<O> } },
    N,
    O,
    readonly [N]
  >;
};

export function withVersioning(
  t: AnyT
): AnyT["procedure"] & { version: VersionFn } {
  const build = (versions: Record<string, unknown>) => {
    const built = t.procedure
      .use(async (opts) =>
        opts.next(
          resolveVersionedRequest({
            ctx: opts.ctx,
            input: await opts.getRawInput(),
            meta: opts.meta,
          })
        )
      )
      .input(z.unknown())
      .meta({ _vrpcVersions: versions, _vrpcOrder: Object.keys(versions) });

    const mutation = built.mutation.bind(built);
    const query = built.query.bind(built);

    return Object.assign(built, {
      version: (name: string, spec: Spec) =>
        build({ ...versions, [name]: stamp(spec) }),
      mutation: (h: Parameters<typeof dispatch>[0]) => mutation(dispatch(h)),
      query: (h: Parameters<typeof dispatch>[0]) => query(dispatch(h)),
    });
  };

  const version = (name: string, spec: Spec) => build({ [name]: stamp(spec) });

  return Object.assign(t.procedure, { version }) as never;
}
