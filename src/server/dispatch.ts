/**
 * Dispatch a per-version handler map at request time.
 *
 * The middleware writes the resolved terminal version to `ctx._vrpcVersion`;
 * we read it here, look up the matching handler, and route the call.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { DispatchError } from "./errors";
import type { Result } from "../types";

const ctxSchema = z.object({ _vrpcVersion: z.string().min(1) }).partial();

type Handler = (args: { input: unknown }) => unknown;

export function dispatch(handlers: Record<string, Handler>) {
  return (opts: { input: unknown; ctx: Record<string, unknown> }) => {
    const r = resolveHandler(handlers, opts.ctx);
    if (!r.ok) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: r.error.message,
      });
    }
    return r.value({ input: opts.input });
  };
}

function resolveHandler(
  handlers: Record<string, Handler>,
  ctx: Record<string, unknown>
): Result<Handler, DispatchError> {
  const { _vrpcVersion: resolved } = ctxSchema.parse(ctx);
  const handler = resolved ? handlers[resolved] : undefined;
  return handler
    ? { ok: true, value: handler }
    : {
        ok: false,
        error: new DispatchError("no handler registered for resolved version"),
      };
}
