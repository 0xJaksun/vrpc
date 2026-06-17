import { test, expect, expectTypeOf } from "vitest";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { withVersioning } from "../src/server/withVersioning";
import { createVRPCClient } from "../src/client/createClient";

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
    v3: ({ input }) => ({
      id: "1",
      email: input.email,
      org: input.org,
    }),
  });

const appRouter = t.router({ createUser });
type AppRouter = typeof appRouter;

test("client narrows .mutate input to pinned version and returns resolved output", () => {
  const v1Client = createVRPCClient<AppRouter, "v1">({
    version: "v1",
    url: "http://localhost:3000/trpc",
  });
  expectTypeOf(v1Client.createUser.mutate)
    .parameter(0)
    .toEqualTypeOf<{ name: string }>();
  expectTypeOf(v1Client.createUser.mutate).returns.resolves.toEqualTypeOf<{
    id: string;
    email: string;
  }>();

  const v3Client = createVRPCClient<AppRouter, "v3">({
    version: "v3",
    url: "http://localhost:3000/trpc",
  });
  expectTypeOf(v3Client.createUser.mutate)
    .parameter(0)
    .toEqualTypeOf<{ name: string; email: string; org: string }>();
  expectTypeOf(v3Client.createUser.mutate).returns.resolves.toEqualTypeOf<{
    id: string;
    email: string;
    org: string;
  }>();
});

test("v1 pin walks forward to v2 handler", async () => {
  const caller = appRouter.createCaller({
    headers: { "x-vrpc-version": "v1" },
  });
  const result = await caller.createUser({ name: "balc" });
  expect(result).toEqual({ id: "1", email: "unknown@example.com" });
});

test("v2 pin lands directly on v2 handler", async () => {
  const caller = appRouter.createCaller({
    headers: { "x-vrpc-version": "v2" },
  });
  const result = await caller.createUser({
    name: "balc",
    email: "balc@x.com",
  });
  expect(result).toEqual({ id: "1", email: "balc@x.com" });
});

test("v3 pin lands directly on v3 handler", async () => {
  const caller = appRouter.createCaller({
    headers: { "x-vrpc-version": "v3" },
  });
  const result = await caller.createUser({
    name: "balc",
    email: "balc@x.com",
    org: "acme",
  });
  expect(result).toEqual({ id: "1", email: "balc@x.com", org: "acme" });
});

test("no pin falls back to latest terminal (v3)", async () => {
  const caller = appRouter.createCaller({ headers: {} });
  const result = await caller.createUser({
    name: "balc",
    email: "balc@x.com",
    org: "acme",
  });
  expect(result).toEqual({ id: "1", email: "balc@x.com", org: "acme" });
});
