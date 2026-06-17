import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";

const VERSION_HEADER = "x-vrpc-version";

export function createVRPCClient<TRouter extends AnyRouter>(
  options: { version: string; url: string } & Omit<
    Parameters<typeof createTRPCClient<TRouter>>[0],
    "links"
  > & {
      links?: Parameters<typeof createTRPCClient<TRouter>>[0]["links"];
    }
) {
  const { url, version, links = [], ...rest } = options;

  const versionLink = httpBatchLink({
    url,
    headers: () => ({ [VERSION_HEADER]: version }),
  });

  return createTRPCClient<TRouter>({
    ...rest,
    links: [versionLink, ...links],
  });
}
