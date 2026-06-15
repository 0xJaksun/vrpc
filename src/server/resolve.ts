import type { z } from "zod";
import { VersionResolveError } from "./errors";
import type { Result } from "../types";

type VersionKey = string;
export type VersionsMeta = Record<
  VersionKey,
  | {
      kind: "terminal";
      input: z.ZodType;
      output: z.ZodType;
    }
  | {
      kind: "walker";
      input: z.ZodType;
      up: (oldInput: unknown) => unknown;
    }
>;

export type ResolvedVersion = {
  terminal: string;
  input: unknown;
};

export function resolveVersion(
  versions: VersionsMeta,
  pin: string,
  initialInput: unknown
): Result<ResolvedVersion, VersionResolveError> {
  if (!versions[pin]) {
    return {
      ok: false,
      error: new VersionResolveError(`unknown version "${pin}"`),
    };
  }

  const order = Object.keys(versions);

  return order
    .slice(order.indexOf(pin))
    .reduce<Result<ResolvedVersion, VersionResolveError>>(
      (acc, name) => {
        if (!acc.ok) return acc;
        const prev = versions[acc.value.terminal];
        if (!prev || prev.kind === "terminal") return acc;
        if (!versions[name]) {
          return {
            ok: false,
            error: new VersionResolveError(
              `version "${name}" missing from map`
            ),
          };
        }
        return {
          ok: true,
          value: { terminal: name, input: prev.up(acc.value.input) },
        };
      },
      { ok: true, value: { terminal: pin, input: initialInput } }
    );
}
