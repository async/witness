# Runtime Routes

## Route Principle

Async Witness routes are ephemeral QA routes bound to local Vite-controlled sessions.
They may serve the box UI, state gallery, receipt timelines, local APIs, and
isolated QA control state, but they are not application routes and should never
be emitted as production output.

Default route prefix:

```text
/__witness
```

## Modes

| Mode                  | Route behavior                                    | Purpose                                                          |
| --------------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Vite dev              | Serve `/__witness` from dev middleware            | run boxes, inspect states/environments, view receipts/timelines  |
| Vite preview          | Serve `/__witness` only on the local preview port | test built output locally and compare build/preview receipt data |
| Production deployment | No Async Witness route                            | avoid exposing QA tooling, project state, timelines, or receipts |

## Dev Server

During `vite dev`, the plugin may attach middleware for:

- the Async Witness UI
- the state gallery
- box metadata
- box execution endpoints
- resolved environment metadata
- local-only APIs for receipt retrieval
- local-only debugging, inspection, and timeline playback

This route should be available only on the active dev server port.

When the UI previews a state, the preview target should be the real app route on
the Vite dev or preview server. If Async Witness embeds the preview in `/__witness`, the
embedded frame should still point at the app URL, for example `/cart?state=empty`.
Async Witness should not synthesize Storybook-style application routes such as
`/__witness/story/empty-cart` as the primary rendering surface.

## Build And Preview

Build testing should not require shipping a Async Witness route in the production app.

The preferred flow is:

1. ask Vite to build the app, using Vite 8 `createBuilder(...)` when appropriate
   and `build(...)` only as the simple or compatibility path
2. start a local preview server
3. attach Async Witness preview instrumentation or a sidecar UI
4. run boxes against the preview port
5. emit receipts

The route may exist on the local preview port during that QA session. It should
not exist on the user's deployed production origin.

Preview route visits should happen against built output whenever possible. If
Async Witness needs a sidecar route for control or receipt viewing, that route should
exist only on the local preview session.

## Security And Exposure

The Async Witness control surface should assume local development unless explicitly
configured otherwise.

Open questions:

- Should remote hosts be rejected by default?
- Should box execution require a local token?
- Should receipt directories be hidden from Vite static serving by default?
