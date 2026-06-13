import { describe, expect, test } from "vitest";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { withVersioning } from "../src/withVersioning";

describe("withVersioning chained .version()", () => {
  const t = initTRPC.create();
  const procedure = withVersioning(t.procedure);

  test("chains a single .version() into .mutation()", () => {
    const createUser = procedure
      .version("v1", {
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
      })
      .mutation(({ input }) => ({ id: "1", name: input.name }));

    expect(createUser).toBeDefined();
  });

  test("chains multiple .version() calls; latest is current schema", () => {
    const createUser = procedure
      .version("v1", {
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
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
        output: z.object({ id: z.string(), email: z.string() }),
      })
      .mutation(({ input, version }) => {
        switch (version) {
          case "v2":
            // input should narrow to v2's shape
            return { id: "1", email: input.email };
          case "v3":
            // input should narrow to v3's shape
            return { id: "1", email: input.email, org: input.test };
        }
      });

    expect(createUser).toBeDefined();
  });

  test("attaches all versions to _vrpcVersions meta", () => {
    const createUser = procedure
      .version("v1", {
        input: z.object({ name: z.string() }),
        output: z.object({ id: z.string() }),
        up: (old) => old,
      })
      .version("v2", {
        input: z.object({ name: z.string(), email: z.string() }),
        output: z.object({ id: z.string(), email: z.string() }),
      })
      .mutation(() => ({ id: "1", email: "x@y.com" }));

    expect(createUser._def.meta).toMatchObject({
      _vrpcVersions: {
        v1: { input: expect.anything(), output: expect.anything() },
        v2: { input: expect.anything(), output: expect.anything() },
      },
    });
  });

  test("works without an up transformer (terminal version)", () => {
    const listPosts = procedure
      .version("v1", {
        input: z.object({ limit: z.number().optional() }),
        output: z.array(z.object({ id: z.string() })),
      })
      .query(() => [{ id: "1" }]);

    expect(listPosts).toBeDefined();
  });
});
