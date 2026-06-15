import { TRPCError } from "@trpc/server";
import { resolveVersion, type VersionsMeta } from "./resolve";
import { z } from "zod";

const VERSION_HEADER = "x-vrpc-version";
const headersSchema = z.record(z.string(), z.unknown());
const versionHeaderSchema = z.string().min(1);

type MiddlewareParams = {
  ctx: Record<string, unknown>;
  input: unknown;
  meta?: { _vrpcVersions?: VersionsMeta };
  next: (args: {
    ctx: Record<string, unknown>;
    input: unknown;
  }) => Promise<unknown>;
};

export async function vrpcMiddleware(params: MiddlewareParams) {
  const versions = params.meta?._vrpcVersions;

  // No version map → vanilla tRPC procedure. Pass through untouched.
  if (!versions) return params.next({ ctx: params.ctx, input: params.input });

  // Pin precedence: explicit header → fallback to latest terminal.
  const pin =
    readVersionHeader(params.ctx["headers"]) ?? latestTerminal(versions);
  if (!pin) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "vrpc: no terminal versions registered",
    });
  }

  const resolved = resolveVersion(versions, pin, params.input);
  if (!resolved.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `vrpc: ${resolved.error.message}`,
    });
  }

  return params.next({
    ctx: { ...params.ctx, _vrpcVersion: resolved.value.terminal },
    input: resolved.value.input,
  });
}

/** Last terminal entry in declaration order. */
function latestTerminal(versions: VersionsMeta): string | undefined {
  return Object.entries(versions)
    .filter(([_key, value]) => value.kind === "terminal")
    .at(-1)?.[0];
}

/** Read the version header value out of ctx.headers (validated via Zod). */
function readVersionHeader(headers: unknown): string | undefined {
  const parsed = headersSchema.safeParse(headers);
  if (!parsed.success) return undefined;
  return versionHeaderSchema.safeParse(parsed.data[VERSION_HEADER]).data;
}
