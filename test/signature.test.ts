import { test } from "vitest";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { withVersioning } from "../src/server/withVersioning";
import { createVRPCClient } from "../src/client/createClient";

const t = initTRPC.create();
const procedure = withVersioning(t);

const ping = procedure
  .version("v1", {
    input: z.object({ name: z.string() }),
    output: z.string(),
  })
  .query({ v1: ({ input }) => input.name });

const router = t.router({ ping });
type R = typeof router;

test("createVRPCClient with 1 explicit generic compiles", () => {
  // If this line shows "Expected 2 type arguments, but got 1" in your editor,
  // your TS server is stale. `pnpm typecheck` will say it's fine.
  const c = createVRPCClient<R, "v1">({ version: "v1", url: "http://x" });
  void c;
});
