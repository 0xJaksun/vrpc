import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { withVersioning } from "../src/server/withVersioning";
import { createVRPCClient } from "../src/client";

/* ------------------------------------------------------------------ */
/* Build the server                                                    */
/* ------------------------------------------------------------------ */

const t = initTRPC.create();
const procedure = withVersioning(t);

const createUser = procedure
  .version("v1", {
    input: z.object({ name: z.string() }),
    up: (old) => ({ ...old, email: "unknown@example.com" }),
  })
  .version("v2", {
    input: z.object({ name: z.string(), email: z.string() }),
    output: z.object({ id: z.string(), email: z.string() }),
  })
  .version("v3", {
    input: z.object({
      name: z.string(),
      email: z.string(),
      org: z.string(),
    }),
    output: z.object({ id: z.string(), email: z.string(), org: z.string() }),
  })
  .mutation({
    v2: ({ input }) => ({ id: "1", email: input.email }),
    v3: ({ input }) => ({ id: "1", email: input.email, org: input.org }),
  });

const appRouter = t.router({ createUser });

type AppRouter = typeof appRouter;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const x = createVRPCClient<AppRouter>({ version: "v1", url: "localhost:3000" });

x.createUser.mutate({ name: "balc" });
