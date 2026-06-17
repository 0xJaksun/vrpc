# vtrpc

Versioning for [tRPC](https://trpc.io). Clients pin a version, the server walks old inputs forward to today's handler.

```ts
const createUser = procedure
  .version("v1", { input: NameOnly,     up: (old) => ({ ...old, email: "unknown@x.com" }) })
  .version("v2", { input: NameAndEmail, output: User })
  .mutation({
    v2: ({ input }) => db.users.insert(input),
  });
```

One handler. One file. Old clients keep working.

## The problem

You ship a procedure. A month later you need to add a field. You can't just change the schema, because there are clients in the wild on builds from last week. They'll keep sending the old shape.

Most codebases handle this by forking:

```ts
createUser
createUserV2
createUserV3
```

By month six the handlers have drifted from each other. By month nine you're scared to delete `V1` because something must still be using it but nobody knows what.

vtrpc lets you write one handler and describe how older shapes flow into it.

## Model

Every procedure has a list of versions. Each version is either:

- a **walker**, which transforms its input shape to the next version's input. No handler.
- a **terminal**, which has the handler.

```
v1 (walker)  ──up()──▶  v2 (terminal)  ──up()──▶  v3 (terminal)
   {name}                  {name, email}             {name, email, org}
                           handler                   handler
```

A client pins a version. The server walks the input forward from that pin until it reaches a terminal, then runs the handler.

```
v1 client sends { name }
        │
        ▼  v1.up()
{ name, email: "unknown@x.com" }
        │
        ▼  v2.handler
{ id, email }
```

## Install

```bash
pnpm add vtrpc @trpc/server @trpc/client zod
```

Requires `@trpc/server ^11`, `zod ^3`. `@trpc/client ^11` only if you use the client.

## Walkthrough

### Declare the chain

```ts
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import { withVersioning } from "vtrpc";

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
  .mutation({
    v2: ({ input }) => ({ id: "1", email: input.email }),
  });
```

Read it top to bottom:

- v1 took a `name`. To get to v2 we filled in a placeholder email.
- v2 takes `name` and `email`, returns the new user. This is where the handler lives.

That's the entire history of the procedure, in one place, in the order it actually happened.

`procedure` is a drop-in replacement for `t.procedure`. Non-versioned routes still work the normal way:

```ts
const health = procedure.input(z.object({})).query(() => "ok");
```

### Wire the router

```ts
export const appRouter = t.router({ createUser });
export type AppRouter = typeof appRouter;
```

Standard tRPC.

### Make headers available on ctx

The pin travels as the `x-vrpc-version` header. Your `createContext` needs to put headers on ctx. Most tRPC apps already do this for auth:

```ts
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: ({ req }) => ({
      headers: Object.fromEntries(req.headers),
    }),
  });
```

If you skip this, the server falls back to the latest terminal and pinning won't work.

### Pin a client

```ts
import { createVRPCClient } from "vtrpc";
import type { AppRouter } from "./server";

const client = createVRPCClient<AppRouter, "v1">({
  version: "v1",
  url: "http://localhost:3000/api/trpc",
});

const result = await client.createUser.mutate({ name: "balc" });
// result: { id: string; email: string }
```

`.mutate(input)` is typed as v1's input. The return type is the resolved terminal's output (v2's).

## How the resolver works

For each request:

1. Read the pin from `ctx.headers["x-vrpc-version"]`. Fall back to the latest terminal if absent.
2. Validate the body against the pin's input schema. A v1 request gets validated as v1.
3. Walk forward: apply `up()` until the next version is a terminal.
4. Run that terminal's handler with the walked input.

If the resolver can't find a path (unknown pin, schema mismatch, missing terminal) it throws a `TRPCError`.

The resolver stops at the first terminal it reaches. A `v1 → v2 → v3 → v4` chain pins v1 to v2's handler, not v4's. A v1 client wants a v1-compatible response, not whatever shape the latest happens to be. v2 was the last shape v1 contracted for.

```
                              ┌─────────────────┐
v1 pin ──┐                    │ v1 → v2 handler │
         │                    └─────────────────┘
v2 pin ──┼─▶ resolver picks ──┤
         │                    ┌─────────────────┐
v3 pin ──┘                    │ v3 → v4 handler │
                              └─────────────────┘
```

## Type guarantees

Three things the type system enforces.

### Walkers can't lie

A walker's `up()` must return something compatible with the next version's input. If it doesn't, TypeScript catches it:

```ts
procedure
  .version("v1", {
    input: z.object({ name: z.string() }),
    up: (old) => ({ ...old }),
  })
  .version("v2", {
    input: z.object({ name: z.string(), email: z.string() }),
    // Error: up's return type does not match next version's input
  });
```

### Clients can't pin nonsense

`TVersion` is constrained to the versions declared in your router:

```ts
createVRPCClient<AppRouter, "v99">({ version: "v99", url });
// Type '"v99"' is not assignable to '"v1" | "v2"'
```

### Handler maps are exhaustive

Every terminal gets its own handler. Input is narrowed, return type is enforced:

```ts
.mutation({
  v2: ({ input }) => ({ id: "1", email: input.email }),
  // input: { name: string; email: string }
  // return must be: { id: string; email: string }
})
```

Add a v3 terminal and the compiler tells you the handler map is missing a `v3` entry.

## Trade-offs

vtrpc has opinions. They aren't free.

**Input narrows per pin. Output is the resolved terminal's.** A v1 client sends v1's input and gets v2's output. There are no down-migrations that map v2's response back to v1's shape. If you need that, transform on the client.

**No subscription versioning.** Queries and mutations only. Subscriptions pass through as normal tRPC subscriptions.

**Headers must be on ctx.** If `createContext` doesn't expose them, the resolver falls back silently to the latest terminal.

**Two generics at the client call site.** `createVRPCClient<AppRouter, "v1">({...})` is the safest signature. Single-generic inference (via `const` type parameters) works in `tsc` but some editors render confusing diagnostics. Writing the literal twice is the price of clean tooling.

**`withVersioning(t)` mutates `t.procedure`.** It bolts `.version()` onto the existing builder in place. Usually fine, occasionally surprising if you keep multiple `t` instances.

**Declaration order matters.** First `.version()` is the oldest, last is the newest. Treat the file like a changelog: append, don't shuffle.

## Reference

### Server

| Export              | Purpose                              |
|---------------------|--------------------------------------|
| `withVersioning(t)` | Extends `t.procedure` with `.version()` |

### Client

| Export                         | Purpose                                  |
|--------------------------------|------------------------------------------|
| `createVRPCClient<R, V>(opts)` | Build a tRPC client pinned to a version  |

### Types

| Type                             | Purpose                                                       |
|----------------------------------|---------------------------------------------------------------|
| `Pin<TRouter>`                   | Union of every declared version across a router               |
| `PinRouter<TRouter, V>`          | Router type with versioned procedures narrowed to a pin       |
| `WalkOutput<V, Order, Pin>`      | The output type resolved from a pin                           |
| `VersionedMutation<V, T, Order>` | The type returned by `.mutation()`                            |
| `VersionedQuery<V, T, Order>`    | The type returned by `.query()`                               |

### Errors

| Class                 | When thrown                                              |
|-----------------------|----------------------------------------------------------|
| `VersionResolveError` | Resolver can't walk to a terminal                        |
| `DispatchError`       | No handler registered for the resolved version           |

## Conventions

**Pin once, import everywhere.** One `createVRPCClient` call per app, in a shared module:

```ts
// src/api/client.ts
export const api = createVRPCClient<AppRouter, "v2">({
  version: "v2",
  url: process.env.NEXT_PUBLIC_API_URL!,
});

// anywhere else
import { api } from "@/api/client";
await api.createUser.mutate({...});
```

Two clients pinned to different versions is supported for gradual migrations but make it intentional.

**Treat the chain like a changelog.** Append, don't reorder. Don't delete an old version until you've verified nothing pins to it.

**One handler per terminal.** Walkers don't have handlers. If a terminal handler is getting complex, that's a sign the version was a bigger break than expected. Consider splitting it into a new procedure rather than overloading the existing one.

## License

MIT
