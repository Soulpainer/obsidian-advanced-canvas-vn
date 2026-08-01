# VN Canvas — Agent Handoff (current state: `main`, includes `fixes/route-correctness` + `fixes/router-perf`)

## What this plugin is

A fork of obsidian-advanced-canvas, stripped to a **visual-novel dialogue graph editor**. Plugin id `vn-canvas`, deployed to `<vault>/.obsidian/plugins/vn-canvas/` via `npm run deploy`. Canvas nodes = dialogue frames, edges = routes. Data in `.canvas` files + `Dialogue/*.md` tables (Characters/Stats/Properties/Triggers), read by a Unity runtime.

Branches:
- `main` (CURRENT) — the VN fork, fully merged. All 5 problems below SOLVED and user-confirmed, plus the route-type model / router-node coloring / dynamic edge-side routing from `fixes/route-correctness` (merged via fast-forward). Note: `main` is no longer the upstream Advanced Canvas — it's the VN fork trunk.
- `new-logic` — VN fork base.
- `vn/dialogue-fixes` — stable: TS fixes, rebrand, upstream cleanup, choice-anchor geometry, CPU fixes, drag-to-spawn, choice-port drag (delegates to native onConnectionPointerdown), occupied-port lock, spawn-cancel cleanup, sequential modal opening (choice → frame). Merged into `main`.
- `vn/edge-split-router` — edge-split feature (double-click route edge → insert router node), color propagation, selection fixes. **Merged into `main` via fast-forward.** Tag `checkpoint-working-state-pre-atomic-split` (`4ec6cdc`) preserved for rolling back the atomic-split change if #3 regresses.
- `fixes/route-correctness` — route-type model (`choice`/`unbound`/`broken`/`unknown`), router-node coloring (validity model + transit color), dynamic edge-side routing on router nodes, halved router node size (28→14px), arrowhead hiding on router endpoints. **Merged into `main` via fast-forward.** See sections below.
- `fixes/router-perf` — router recompute performance: replaced O(E) edge scans with the native adjacency index, and the O(N·E) full-sweep recompute with targeted recompute (only affected routers + downstream cascade). Behavior-preserving. **Merged into `main` via fast-forward.** See "Router recompute performance" below.

## How to deploy & test

```bash
npm run deploy          # build + copy to vault
# then toggle plugin OFF/ON in Obsidian (Settings → Community plugins)
# Console: Ctrl+Shift+I
```

## Architecture (key files)

- `src/canvas-extensions/dialogue-choice-route-canvas-extension.ts` — route rendering, choice-port drag, edge-split, color, anchor geometry, dynamic edge-side routing on router nodes. **The file with the most active work.**
- `src/canvas-extensions/dialogue-frame-canvas-extension.ts` — frame rendering, choice ports (DOM), frame editor modal, spawn-cancel cleanup.
- `src/canvas-extensions/dialogue-router-canvas-extension.ts` — router nodes, context menu, spawn menu (drag-to-spawn on empty), interaction-layer data attributes (resize-disable), **router-node coloring** (`resolveNodeColor`, `renderRouterNode`, `edgeRouteColor`).
- `src/utils/dialogue-route-color.ts` — shared color helpers: `routeToColorCss`, `getRouteColorCss`, `resolveCssColor` (var→rgb), `resolveChoiceIndex`. Used by both route-render and router-node-color so they agree on colors.
- `src/patchers/canvas-patcher.ts` — monkey-patches Obsidian Canvas, emits `advanced-canvas:*` events. `edge.render` patched → `edge-rendered:after`.
- `src/styles.scss` — choice port CSS, router CSS, resize-disable, connection-point reposition, dash patterns (`dashed-broken`/`dashed-unknown`/`short-dashed`), router-color CSS variable (`--dialogue-router-color`).
- `src/@types/DialogueCanvas.ts` — `DialogueRouteType = "failure" | "choice" | "unbound" | "broken" | "unknown"`, plus `DialogueBrokenRouteData` / `DialogueUnknownRouteData`.

## Key concepts

- **Route edge**: an edge with `x-dialogue.route = {type:"choice", choiceId, outcome, choiceIndex}` in its DATA. Only route edges are colored, splittable, and participate in dialogue routing. **Route must be in edge data, NOT applied as a visual hack at render time** (that was tried and failed — edges looked colored but couldn't be split).
- **Choice port drag**: pointerdown on `.dialogue-canvas-choice-swatch` / `.dialogue-canvas-choice-failure-port` → delegates to `sourceNode.onConnectionPointerdown(event, "right")` for a native floating-end drag. `pendingChoiceRoute` remembers the choice; `onEdgeCreatedFromChoicePort` binds it via `saveRoute`.
- **Edge-split**: double-click a route edge → insert router node at click point, split edge into two route edges (source→router, router→target), both carrying the route binding.
- **Color propagation**: edges dragged FROM a router are **never grey** — they become route edges via the router-as-color-transit logic. The outgoing route TYPE is resolved from the router's incoming set (see "Route-type model" below), then colored. Reactive: `edge-created`/`edge-removed`/`edge-changed` + `node-changed` → `scheduleRecomputeAllRouters` (rAF-coalesced full sweep over every router). See problem #2.

---

## Route-type model (`fixes/route-correctness`)

A route edge carries `x-dialogue.route.type` of one of:
- **`"choice"`** — bound to a specific choice (`choiceId` + `outcome` + cached `choiceIndex`). Renders as the choice's palette color (success: solid, failure: short-dashed).
- **`"unbound"`** — a valid route line NOT bound to a choice. Solid neutral grey. A router with 0/multiple/mixed incoming emits `unbound` on its outgoing edges.
- **`"broken"`** — the choice reference is invalid (choice was deleted from the source frame, or ALL incoming routes are themselves broken). Red dashed (`dashed-broken`). Propagates: if all incoming → broken, outgoing → broken.
- **`"unknown"`** — the router has NO incoming route edges at all (no source upstream). Grey dashed (`dashed-unknown`). Distinct from unbound (solid grey, ambiguous-but-valid) — unknown is the "nothing connected" state.
- **`"failure"`** — legacy/dead type, still in the union for migration safety. Treat as `choice` with `outcome: "failure"` where it appears.

**Resolution** (`resolveOutgoingRoute`, `applyOutgoingRoute` in the route-canvas extension): for a router, count incoming route edges (choice + unbound count; broken propagates; unknown = "no source"):
- exactly 1 resolvable incoming choice → inherit it (`choice` + that choiceId/outcome/choiceIndex → color)
- exactly 1 incoming unbound, OR 0 incoming, OR 2+ mixed → `unbound`
- ALL incoming broken → `broken`
- NO incoming routes → `unknown`

`applyOutgoingRoute` normalizes before persist (degrades an unresolved choice → unbound, preserves cached `choiceIndex`), and only writes when the route actually differs (`routesEqual`) — no infinite loop.

---

## Router-node coloring (`fixes/route-correctness`)

Router nodes (14px dots, `x-dialogue.router.type = "point"`) are colored to reflect their connectivity state. CSS via `--dialogue-router-color` + `data-router-state` attribute. Computed in `resolveNodeColor` (router extension):

- **`colored`** — the router is a clean transit: exactly 1 incoming + 1 outgoing route, and they carry the SAME color (resolved to rgb, not var-string compared — see lesson 18). Painted that color.
- **`white`** — valid on both sides but ambiguous (multiple incoming, or in+out of different valid colors). Light color so the dot is visible on dark canvas.
- **`warning`** (grey, opacity 0.55) — partially connected (only an in OR only an out, but no broken route). The "something's dangling" hint.
- **`colored` red** — special case of partial: the one connected side is ALL broken → paint red so the broken state is visible even on a partially-connected router.

**Validity model**: `choice`/`unbound`/`broken` are valid endpoints (carry a color); only `unknown` is invalid (no source → grey warning). A node is "colored" only when single in+out of the same color; everything else degrades to white/warning.

**Color resolution** (`edgeRouteColor`): returns a concrete rgb color for `choice`/`unbound`/`broken`, null for `unknown` and default edges. Choice validation: if the choiceId doesn't resolve against the source frame's choices AND the source has choices, returns null (treated as broken upstream).

---

## Dynamic edge-side routing (`fixes/route-correctness`)

Route edges attached to **router** nodes don't use a fixed face — the face is computed geometrically at render time so the line always points toward its neighbor. Only router nodes get dynamic sides; frame/target sides stay as stored in edge data (frame choice-port anchoring must stay). Computed per render-pass and cached in `routerSideCache: WeakMap<Canvas, WeakMap<CanvasNode, Map<string, {fromSide, toSide}>>>` so every edge of one router agrees within a pass.

**Algorithm** (`computeRouterEdgeSides`, in route-canvas extension): walks a router's edges once, classifies incoming/outgoing, assigns sides:
- Each edge attaches to the face nearest its own neighbor (source for incoming, target for outgoing). `nearestSide(from, to)` picks the axis (horizontal/vertical) with the larger delta, then the direction along it; ties go horizontal.
- This was the final settled rule after two regressions (see "Edge-side history" below).

**Render integration** (`renderRouteEdge`): for a router source, `fromSide` comes from `resolveRouterEdgeSide(...)` instead of `edge.from.side`; for a router target, `toSide` likewise. Arrowheads (`edge.fromLineEnd`/`edge.toLineEnd`) are hidden on router endpoints — a router is a transit point and the native arrowhead is positioned off our computed anchor anyway.

**Re-render timing**: `renderCanvas` clears `routerSideCache` at the start of each pass. `node-moved` only triggers `scheduleRenderCanvas` on drag RELEASE (`usingKeyboard === true`), NOT per-move — per-move live updates were tried and were both slow and broke colors (reverted).

**Edge-side history** (don't repeat these):
- Axis-forcing (both edges onto one shared axis for 1-in/1-out): sent an edge to the wrong face when neighbors were on different axes → coils on roughly straight layouts.
- U-turn flip (push output to opposite face when both neighbors shared a face): sent output AWAY from its target → loops on same-side layouts.
- Final rule: plain "nearest face per edge" handles opposite-face (straight), perpendicular (smooth 90°), and same-face (short overlap on the shared face, reads fine for a 14px router) without special-casing.

---

## Router recompute performance (`fixes/router-perf`)

The reactive router-transit recoloring used to be O(N·E) on **every** edge event: `scheduleRecomputeAllRouters` walked every router (O(N)), and each router's `resolveOutgoingRoute` / `recomputeRouterOutgoing` scanned every edge on the canvas (O(E)). On a graph with 50 routers + 100 edges that's 10 000 iterations per edge-changed — and `edge-changed` fires on every render during a drag/pan. Two changes fixed it, both behavior-preserving:

**1. Native adjacency index instead of O(E) scans.** Obsidian's Canvas already keeps per-node edge indexes: `canvas.edgeFrom.get(node)` (outgoing), `canvas.edgeTo.get(node)` (incoming), `canvas.getEdgesForNode(node)` (union) — all O(1). They're declared in `src/@types/Canvas.d.ts` and were used in exactly one place before. Replaced 5 hot scans: `resolveOutgoingRoute`, `recomputeRouterOutgoing`, `computeRouterEdgeSides`, `renderNodeRoutes`, and `resolveNodeColor`/`hasOutgoingEdge` (router ext). Helper: `edgesForNode(canvas, node, direction)` in both extensions (one null-safe point of access).

**2. Targeted recompute instead of full sweep.** `onEdgeRouteAffected` now collects the edge's current `fromNode`+`toNode` as "affected", and the rAF pass (`runRecompute`) recomputes only those routers + their downstream cascade (the existing `visited`-set cascade still walks the graph). `node-changed` (frame choices edited) is targeted too: collect routers fed by that frame's outgoing edges via `edgeFrom`, instead of sweeping everything.

**Retarget correctness** — the subtle part: `edge.setData` overwrites `fromNode`/`toNode` in the native call *before* firing `edge-changed`, so by event time `getData()` already reflects the NEW endpoint — the detached OLD endpoint (the router no longer connected) is invisible. To catch it, `lastEdgeEndpoints` (per-canvas Map<edgeId, {fromNode,toNode}>) remembers each edge's last-seen endpoints; `onEdgeRouteAffected` diffs current vs previous and adds any changed endpoint to the affected set. Cleaned up on `edge-removed`.

**Kept:** rAF-coalescing (one pass per frame, regardless of how many events fired) — `edge-changed` is ambiguous (fires on geometry-only renders too, not just data changes), so coalescing to the next frame when state is settled is correct. `routesEqual` still makes the no-op case cheap. A full-sweep escape hatch (`scheduleRecomputeAllRouters`) is retained but off the hot paths.

---

## SOLVED PROBLEMS (all user-confirmed, merged to `main`)

### 1. Router-node selection doesn't work (Delete broken) — SOLVED ✅

**Root cause: DOM focus theft, not selection.** Console probes comparing the broken (post-split) vs working (post-click) states showed the ONLY difference was `activeDocument.activeElement`:
- after split: `.embed-iframe.is-controlled` → Delete's keypress never reached the canvas → `e.onKeydown`/`e.deleteSelection` not called.
- after a real click: `.canvas-wrapper` → Delete worked.

Everything else was identical: `selection.size === 1`, `getSelectionData().nodes.length === 1`, `readonly === false`, `isDragging === false`, node identity intact (`canvas.nodes.get(id) === routerNode`). So selection-set membership, `nodeInteractionLayer.setTarget`, node identity, and `getSelectionData` were all **red herrings** — the node was correctly selected all along.

The rAF `selectOnly` + `wrapperEl.focus()` DID put focus on the wrapper momentarily, but the freshly-imported edges / iframe content render asynchronously and steal focus to `.embed-iframe.is-controlled` right after. A real click worked only because it was the last focus change.

**Fix (in `onEdgeDoubleClick`):** after `importData`, re-assert `canvas.wrapperEl.focus()` at rAF + 50/150/400ms to win the race past the theft. Multiple delays are kept ON PURPOSE — the theft's timing varies, extra `focus()` calls are free, and one missed re-assert brings the whole bug back.

**What was tried (dead ends, don't repeat):**
- `selectOnly` sync / via `setTimeout(0)` / via `rAF` — focused on the wrong thing; selection was never the issue.
- `updateSelection(() => { deselectAll; selection.add(node) })` — broke canvas rendering (reverted).
- Synthesized `dispatchEvent(click)` — put node in selection but is untrusted, doesn't move focus, and masked the symptom (regression).
- Single `wrapperEl.focus()` in rAF — correct idea, but stolen by async iframe rendering before Delete fired.

**Lesson:** when a canvas keyboard action fails after a mutation, check `activeDocument.activeElement` FIRST — selection state is usually fine. See lesson 15.

### 2. Edges dragged from router are grey / can't be split — SOLVED ✅ ( redesigned as "router as color transit" )

Original symptom: dragging a new edge FROM a router left it grey (no route), unsplittable. The original one-shot inheritance (`findInheritedRoute` → `saveRoute` in `onEdgeCreatedFromChoicePort`) was flaky and didn't cover 0/multiple-incoming cases.

**Redesign:** a router is now a *color transit*. Every edge leaving a router is a route edge (never default/grey). The route KIND depends on the router's incoming route edges:
- New route type `"unbound"` (`x-dialogue.route = {type:"unbound"}`) — a valid route line NOT bound to a choice. Renders as a themed neutral color (`--dialogue-route-unbound-color`, grey-ish, visible on light+dark).
- **Outgoing color rule** (counting only route edges — choice + unbound — into the router; default grey edges ignored):
  - exactly 1 incoming **choice** → inherit it (choiceId/outcome/choiceIndex → that choice's color)
  - exactly 1 incoming **unbound**, OR 0, OR 2+, OR mixed → **unbound** (white)
- **Reactive + cascading:** `edge-created` / `edge-removed` / `edge-changed` → `onEdgeRouteAffected` finds router nodes whose incoming/outgoing set changed (the edge's `toNode` and `fromNode`), calls `recomputeRouterOutgoing`, which resolves the outgoing route and cascades downstream (router→router→...), guarded by a `visited` Set against cycles. `applyOutgoingRoute` only calls `setData` when the route actually differs (`routesEqual`) → no infinite loop.
- **Split supports unbound:** double-clicking a white line splits it into two white lines.

**Key functions** (all in `dialogue-choice-route-canvas-extension.ts`):
- `getRoute(route)` — any route (choice OR unbound); used everywhere we ask "is this a route edge". Replaces the old `getChoiceRoute`-as-presence-check at render sites.
- `resolveOutgoingRoute(canvas, routerId)` — the color rule above.
- `applyOutgoingRoute(canvas, edge, route)` — sets an edge's route; returns whether it changed.
- `recomputeRouterOutgoing(canvas, routerNode, visited)` — resolve + apply + cascade.

**What's left / to verify in runtime:**
- Cascade timing on fast edge edits (the `edge-changed` re-entrancy) — `routesEqual` guards against loops but worth watching.
- Behavior when a router has a mix of incoming choice + incoming default — by design defaults are ignored, so a router with 1 choice + 1 default inherits the choice color. Confirm that's desired.
- The earlier `saveRoute` choiceIndex-preservation fix (lesson 13) is now subsumed by `applyOutgoingRoute`, which preserves `choiceIndex` the same way.

**Stale-color fix (edge retargeted):** the initial reactive listener tried to derive the affected router from the edge's current `fromNode`/`toNode`. That missed the key case: when a dragged edge is released on a *different* target, the PREVIOUS `toNode` (a router no longer connected) doesn't appear in the event, so its outgoing edges stayed colored per a now-stale incoming set. Fixed by replacing targeted recomputation with `scheduleRecomputeAllRouters` — a rAF-coalesced pass that recomputes EVERY router against the settled graph state. `routesEqual` makes the no-op case (most routers unchanged) cheap; reentrancy is bounded by the `recomputeFrames` dedup + `routesEqual` (a re-triggered second pass writes nothing). Coalescing is necessary because `edge-changed` fires on every edge render during pan/move/drag.

### 3. Edge-split sometimes breaks canvas rendering — PREVENTATIVELY ADDRESSED ✅ (verify in runtime)

Splitting a **long** edge sometimes corrupted the canvas display (nodes/edges disappear or glitch) until the canvas was reloaded. Not reproducible at the time of the fix; addressed preventatively.

**Root cause (from commit 72f3fe9):** the split modified the canvas in steps — `createTextNode` (adds node) → `setData` (modifies) → `removeEdge` (deletes edge) → `importData` (adds edges). Between steps, Obsidian could re-render (via `edge-rendered:after`) in an inconsistent state (an edge referencing a node whose data isn't ready), which intermittently broke the canvas until reload.

**What happened:** commit `72f3fe9` rewrote split to be atomic (router node + both edges in one `importData`). But the unbound-route feature (`82572b4`) reintroduced `createTextNode` + `setData` because it needed control over the route payload — re-creating the very intermediate-state structure that caused #3. The bug wasn't *observed* after that (likely because the unbound refactor also made `renderRouteEdge` tolerant of partial state — it renders via the unbound color instead of bailing on `choiceIndex < 0` — and the rAF-deferred focus gives the canvas a frame to settle). But the structural risk was back.

**Fix:** reverted the split to the atomic pattern — generate `routerId` upfront, build the router node + both edges as data, apply in ONE `importData`. The unbound route payload flows through unchanged (`splitRoute` is built the same way). The focus-fix re-fetches the node by `routerId` after `importData` (importData rebuilds node objects). The whole canvas transitions atomically from one stable state to another.

**Checkpoint:** tag `checkpoint-working-state-pre-atomic-split` (commit `4ec6cdc`) marks the working state before this change.

**⚠️ ROLLBACK INSTRUCTIONS:** if long-edge / rendering problems reappear on split, revert the atomic-split commit:
```
git revert <atomic-split-commit-hash>
# or, to discard everything since the checkpoint:
git reset --hard checkpoint-working-state-pre-atomic-split
```
The pre-atomic version (with `createTextNode` + `setData`) is known-working for the user as of this writing; #3 was not observed there.

### 4. Choice-port drag from OCCUPIED ports — SOLVED ✅

Occupied ports (with route) are dimmed via CSS (`pointer-events: none`) and the capture handler bails. Confirmed working by the user. The JS guard remains as a fallback for the CSS-not-loaded edge case.

### 5. Lag: route edges during pan-over-edge — SOLVED ✅ (pre-existing, fixed earlier)

Panning the canvas with the middle mouse button over an edge previously caused route edges to lag/drift. Confirmed fixed by the user earlier in the branch's history (the geometry-only anchor fix + synchronous `edge-rendered:after` rendering resolved it). The viewport-change-listener idea in earlier drafts was not needed.

---

## IMPORTANT LESSONS LEARNED (don't repeat these mistakes)

1. **Route must be in edge DATA, not visual.** Coloring an edge in `renderRouteEdge` without writing `x-dialogue.route` into the edge data makes it look right but breaks splitting and routing. Always use `saveRoute` to write route data.

2. **`menu.hide()` on `canvas:node-connection-drop-menu` doesn't work.** That event lets you ADD items to a not-yet-shown menu. To suppress spawn items, use a dataset flag on `canvas.wrapperEl` that the router's drop-menu handler checks.

3. **`event.preventDefault()` before `onConnectionPointerdown` kills the drag.** Obsidian checks `event.defaultPrevented`. Only use `stopPropagation`.

4. **Stale canvas after menu click.** The `canvas` object captured when a menu is shown can be stale by the time the user clicks an item. Always use `this.plugin.getCurrentCanvas()` inside menu `onClick` handlers.

5. **`choiceId` is 1-based positional, not array index.** choiceId "3" = choices[2]. The geometric anchor formula must match choiceId to row index correctly (subtract 1 or use `findIndex`).

6. **Field initializers run AFTER `super()` in the base class.** `CanvasExtension` base constructor calls `this.init()` from `super()`, which runs before TS field initializers. Map/Set fields must be created at the top of `init()`, not inline.

7. **`overflow: hidden` on `.canvas-node-container` clips ports at `right: -7px`.** Either set `overflow: visible` for dialogue frames, or keep ports inside the bbox.

8. **Obsidian resize handles are in `.canvas-node-interaction-layer`** (one per canvas), with `.canvas-node-resizer[data-resize="right|topright|bottomright|..."]`. Disable specific sides via `pointer-events: none` + a data attribute on the interaction layer.

9. **Two MutationObservers were the main CPU hog:** body+subtree (menu) and wrapperEl+subtree+attributes (frame). Narrowed to childList-only on body and wrapperEl respectively.

10. **`renderRouteEdge` must be called synchronously on `edge-rendered:after`**, not via rAF — otherwise native edge.render in the next frame overwrites the path (routes collapse to a point during drag/resize).

11. **Choice anchor geometry is calibrated from real DOM measurements:** row height 22px (no failure) / +30px (with failure), success port at row center (half row height), failure port at 38px from row top, list anchored 8px from node bottom, 4px gap between rows. See `getChoiceAnchorGeometric`.

12. **`AGENTS.md` requires LLM-agent marking** on all changes — commit prefix `[LLM agent]` and in-code comments.

13. **A router node has no `frame.choices`, so any `choices.findIndex(...)` in a code path that also serves routers returns -1.** Don't blanket-coerce that to 0 — it silently overwrites a legitimately-inherited/cached `choiceIndex`. When the route already carries a cached `choiceIndex` (set by a prior `saveRoute` or edge-split), preserve it; only fall back to 0 as a last resort. (Bug behind problem #2's wrong color on router-originated edges.)

14. **`createTextNode` initialization is async relative to `setData`.** The patcher's `runAfterInitialized` defers `node-added`/`node-changed` until the native node `initialize()` runs, and the `setData` patch guards the `node-changed` trigger behind `node.initialized && !node.isDirty`. So `selectOnly` / render calls immediately after `createTextNode` + `setData` may run against a not-yet-initialized node. Defer with `requestAnimationFrame` if you need the fully-initialized node.

15. **Canvas keyboard actions (Delete/Backspace) depend on `activeDocument.activeElement`, not on `canvas.selection`.** A node can be correctly selected (`selection.has === true`, `getSelectionData().nodes.length === 1`, identity intact) yet Delete still does nothing — because `onKeydown`/`deleteSelection` only fires when the canvas wrapper holds focus. After mutations that render asynchronously (`importData` of edges, iframe content), focus gets stolen to `.embed-iframe.is-controlled`; a single `wrapperEl.focus()` is also stolen moments later. **When a canvas keyboard action fails after a mutation, check `activeDocument.activeElement` FIRST** (vs `canvas.wrapperEl`) — don't waste cycles on selection/identity/getSelectionData. Re-assert `wrapperEl.focus()` at several delays (rAF + 50/150/400ms) to win the race; the delays are cheap and a missed re-assert brings the whole bug back. Do NOT fake clicks via `dispatchEvent` — untrusted events don't move focus and mask the symptom.

16. **A reactive cascade that calls `setData` must guard against re-entrancy loops.** `setData` fires `edge-changed`, which our cascade listens to → would re-run the cascade → `setData` again → infinite loop. Guard with structural equality (`routesEqual`) so `applyOutgoingRoute` skips when the value didn't change: the second pass finds nothing to write and the chain terminates. Use a `visited` Set keyed by node id to protect against cycles in the node graph itself (router A → router B → router A).

17. **"Unbound" is a first-class route kind, not a degenerate choice.** Routes that aren't tied to a specific choice (e.g. a router's outgoing line when the incoming color is ambiguous) still need to be real route edges — colored, splittable, participating in routing — just with a neutral color. Modeled as `type: "unbound"` rather than a choice with a sentinel choiceId, so the type system keeps choice-only code (`getChoiceRoute`, the binding modal) honest and the render path can branch cleanly.

18. **Compare resolved rgb colors, never raw `var()` strings.** Different route types can map to visually-identical colors via different CSS variables (e.g. `--dialogue-route-unknown-color` and `--dialogue-route-unbound-color` are both grey but different strings). A `string === string` check would wrongly call them different and flip a router node to "ambiguous/white". Always resolve to concrete rgb first (`resolveCssColor`), then compare. (Bug behind router-node coloring flipping valid same-color nodes to white.)

19. **Cached `choiceIndex` must not mask a broken choice.** A choice route's cached `choiceIndex` is a color hint set at bind time. If the choice was later deleted from the source frame, the cache would still hold a valid index and the edge would render in the choice color, hiding the broken reference. Only use the cache when the fromNode is a router (no choices to validate against); when the fromNode is a frame with choices, validate the choiceId against the live choices and degrade to `broken` if absent.

20. **Edge-side routing: don't over-engineer.** For router-node edge sides, "nearest face per edge" is the correct default. Two attempts to be smarter both regressed: forcing both edges of a 1-in/1-out router onto one shared axis sent an edge to the wrong face when neighbors were on different axes; flipping the output to the opposite face when neighbors shared a face sent the output away from its target. Only special-case a genuine collision you can actually observe, not a hypothetical one. (See "Edge-side history" in the dynamic edge-side section.)

21. **Obsidian Canvas keeps a native per-node edge index — use it, don't re-scan.** `canvas.edgeFrom.get(node)` / `canvas.edgeTo.get(node)` / `canvas.getEdgesForNode(node)` are O(1) lookups (declared in `src/@types/Canvas.d.ts`), kept consistent by `addEdge`/`removeEdge` before any event listener sees them. The route extension originally scanned `canvas.edges.values()` with a nodeId filter in ~12 places — O(E) each, O(N·E) when nested inside a per-router loop. Replacing those scans with the index turned O(N·E) passes into O(N·attached).

22. **When an event reflects a mutation, the PREVIOUS state is already gone.** `edge.setData` overwrites `fromNode`/`toNode` in the native call *before* firing `edge-changed`, so a listener can't see the old endpoint — only the new one. If you need to react to what was *detached* (e.g. a router that lost its incoming edge when the line was retargeted), you must remember the previous value yourself (per-id `lastEdgeEndpoints` map) and diff against the current one. Don't assume the event payload preserves the pre-mutation state.

---

## PENDING / DEFERRED TASKS

Items acknowledged but not yet done. Ordered roughly by priority.

- **Validation command**: collect all `broken` / `unknown` route edges across the canvas and surface them as a list/modal, so the author can find every dangling route. Currently broken/unknown are only visible by their red/grey dashed lines on the canvas.
- **`enforceSingleOutgoingEdge` history / determinism**: the spawn-edge-disappeared bug was fixed by capturing + removing the native drag edge, but the broader non-determinism in how Obsidian fires `edge-created` during a floating drag deserves a closer look.
- **Self-loop on a router node (#6)**: a route edge whose both endpoints are the same router. Currently unhandled; likely renders as a degenerate path. Low priority until it shows up in real use.
- **Dead `"failure"` route type**: `DialogueRouteType` still includes `"failure"` for migration safety, but it's effectively `choice` + `outcome:"failure"`. Audit whether any persisted data still uses bare `type:"failure"`; if not, remove from the union.
- **Migration version**: the `x-dialogue` schema has grown (route types, router data) but there's no versioned migration step. If old `.canvas` files with bare `type:"failure"` exist, they'd need normalization.
- **`getLinkedChoiceRoutes` ignores unbound**: the helper that walks a router's incoming edges to find a choice route ignores `unbound`/`broken`/`unknown`. Confirm this is intentional (it's used for the "inherit single choice" path) and not silently dropping valid cases.

## KNOWN EDGE-SIDE LIMITATIONS (current state, user-accepted)

The dynamic edge-side routing (nearest-face-per-edge) is the settled rule and the user has accepted the current behavior. Known limitations that were explored and left as-is:
- **Same-face overlap**: when a router's two neighbors are on the SAME face, both edges attach to that face and briefly overlap on the 14px router. Reads fine in practice; the U-turn flip "fix" made it worse (loops).
- **No live update during drag**: edge sides recompute only on drag RELEASE (`usingKeyboard === true`), not per-move. Per-move live update was slow and broke colors (reverted). If a node is dragged and the visual feels stale until release, this is why.
