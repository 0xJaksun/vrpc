import { describe, expect, test } from "vitest";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { extendProcedure } from "../src/server/extendProcedure";

describe("extendProcedure", () => {
  const t = initTRPC.create();
  const publicProcedure = extendProcedure(t.procedure);

  test("vanilla tRPC chain still works (.input().query())", () => {
    const getHello = publicProcedure
      .input(z.object({ name: z.string() }))
      .query(({ input }) => `hello ${input.name}`);

    expect(getHello).toBeDefined();
  });

  test("vanilla tRPC chain works for mutations", () => {
    const createPost = publicProcedure
      .input(z.object({ title: z.string() }))
      .output(z.object({ id: z.string() }))
      .mutation(({ input }) => ({ id: input.title }));

    expect(createPost).toBeDefined();
  });

  test("versioned chain with per-version handlers map", () => {
    const createUser = publicProcedure
      .version("v1", {
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
      })
      .mutation({
        v1: ({ input }) => ({ id: input.name }),
      });

    expect(createUser).toBeDefined();
  });

  test("middleware composes with versioning (.use().version().mutation())", () => {
    const authedProcedure = publicProcedure.use(({ next }) =>
      next({ ctx: { user: { id: "u1" } } })
    );

    const createPost = authedProcedure
      .version("v1", {
        input: z.object({ title: z.string() }),
        output: z.object({ id: z.string() }),
      })
      .mutation({
        v1: ({ input }) => ({ id: input.title }),
      });

    expect(createPost).toBeDefined();
  });

  test("meta composes with versioning (.meta().version().mutation())", () => {
    const withMeta = publicProcedure.meta({ description: "creates a user" });

    const createUser = withMeta
      .version("v1", {
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
      })
      .mutation({
        v1: ({ input }) => ({ id: input.name }),
      });

    expect(createUser).toBeDefined();
  });

  test("walker→terminal chain with handlers map", () => {
    const createUser = publicProcedure
      .version("v1", {
        input: z.object({ name: z.string() }),
        up: (old) => ({ ...old, email: "unknown@example.com" }),
      })
      .version("v2", {
        input: z.object({ name: z.string(), email: z.string() }),
        output: z.object({ id: z.string(), email: z.string() }),
      })
      .mutation({
        v2: ({ input }) => ({ id: "1", email: input.email }),
      });

    expect(createUser).toBeDefined();
  });
});
