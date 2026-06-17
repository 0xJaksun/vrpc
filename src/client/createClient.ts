import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import type { Pin, PinRouter } from "../types";

const VERSION_HEADER = "x-vrpc-version";

/** Typed tRPC client pinned to a single version of a vrpc router. */
export type VRPCClient<
  TRouter extends AnyRouter,
  TVersion extends Pin<TRouter>
> = ReturnType<typeof createTRPCClient<PinRouter<TRouter, TVersion>>>;

export function createVRPCClient<
  TRouter extends AnyRouter,
  TVersion extends Pin<TRouter>
>(options: { version: TVersion; url: string }): VRPCClient<TRouter, TVersion> {
  const { url, version } = options;

  const versionLink = httpBatchLink({
    url,
    headers: () => ({ [VERSION_HEADER]: version }),
  });

  return createTRPCClient<PinRouter<TRouter, TVersion>>({
    links: [versionLink],
  });
}
