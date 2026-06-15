import { describe, expect, test } from "vitest";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { withVersioning } from "../src/withVersioning";

describe("withVersioning chained .version()", () => {
  const t = initTRPC.create();
  const procedure = withVersioning(t.procedure);

  test("single terminal: per-version handler map", () => {
    const createUser = procedure
      .version("v1", {
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
      })
      .mutation({
        v1: ({ input }) => ({ id: input.name }),
      });

    expect(createUser).toBeDefined();
  });

  test("multi-terminal: each handler typed to its version's input AND output", () => {
    const createUser = procedure
      .version("v1", {
        input: z.object({ name: z.string() }),
        up: (old) => ({ ...old, email: "unknown" }),
      })
      .version("v2", {
        input: z.object({ name: z.string(), email: z.string() }),
        output: z.object({ id: z.string(), email: z.string() }),
      })
      .version("v3", {
        input: z.object({
          name: z.string(),
          email: z.string(),
          test: z.string(),
        }),
        output: z.object({
          id: z.string(),
          email: z.string(),
          test: z.string(),
        }),
      })
      .mutation({
        // input is v2's input shape; output must be v2's output shape
        v2: ({ input }) => ({ id: "1", email: input.email }),
        // input is v3's input shape; output must include `test`
        v3: ({ input }) => ({
          id: "1",
          email: input.email,
          test: input.test,
        }),
      });

    expect(createUser).toBeDefined();
  });

  test("attaches all versions to _vrpcVersions meta", () => {
    const createUser = procedure
      .version("v1", {
        input: z.object({ name: z.string() }),
        up: (old) => ({ ...old, email: "x" }),
      })
      .version("v2", {
        input: z.object({ name: z.string(), email: z.string() }),
        output: z.object({ id: z.string(), email: z.string() }),
      })
      .mutation({
        v2: ({ input }) => ({ id: "1", email: input.email }),
      });

    expect(createUser._def.meta).toMatchObject({
      _vrpcVersions: {
        v1: { input: expect.anything() },
        v2: { input: expect.anything(), output: expect.anything() },
      },
    });
  });

  test("query with terminal handler", () => {
    const listPosts = procedure
      .version("v1", {
        input: z.object({ limit: z.number().optional() }),
        output: z.array(z.object({ id: z.string() })),
      })
      .query({
        v1: () => [{ id: "1" }],
      });

    expect(listPosts).toBeDefined();
  });
});
