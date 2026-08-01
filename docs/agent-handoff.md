# VN Canvas — Agent Handoff (current state: branch `vn/edge-split-router`)

## What this plugin is

A fork of obsidian-advanced-canvas, stripped to a **visual-novel dialogue graph editor**. Plugin id `vn-canvas`, deployed to `<vault>/.obsidian/plugins/vn-canvas/` via `npm run deploy`. Canvas nodes = dialogue frames, edges = routes. Data in `.canvas` files + `Dialogue/*.md` tables (Characters/Stats/Properties/Triggers), read by a Unity runtime.

Branches:
- `main` — upstream Advanced Canvas.
- `new-logic` — VN fork base.
- `vn/dialogue-fixes` — stable: TS fixes, rebrand, upstream cleanup, choice-anchor geometry, CPU fixes, drag-to-spawn, choice-port drag (delegates to native onConnectionPointerdown), occupied-port lock, spawn-cancel cleanup, sequential modal opening (choice → frame).
- `vn/edge-split-router` (CURRENT) — edge-split feature (double-click route edge → insert router node), color propagation, selection fixes. **#1 (post-split Delete) SOLVED, #2 (router as color transit — unbound routes) SOLVED (pending runtime verify), #3 (render-break on long edges) unsolved.**

## How to deploy & test

```bash
npm run deploy          # build + copy to vault
# then toggle plugin OFF/ON in Obsidian (Settings → Community plugins)
# Console: Ctrl+Shift+I
```

## Architecture (key files)

- `src/canvas-extensions/dialogue-choice-route-canvas-extension.ts` — route rendering, choice-port drag, edge-split, color, anchor geometry. **The file with the most active work.**
- `src/canvas-extensions/dialogue-frame-canvas-extension.ts` — frame rendering, choice ports (DOM), frame editor modal, spawn-cancel cleanup.
- `src/canvas-extensions/dialogue-router-canvas-extension.ts` — router nodes, context menu, spawn menu (drag-to-spawn on empty), interaction-layer data attributes (resize-disable).
- `src/patchers/canvas-patcher.ts` — monkey-patches Obsidian Canvas, emits `advanced-canvas:*` events. `edge.render` patched → `edge-rendered:after`.
- `src/styles.scss` — choice port CSS, router CSS, resize-disable, connection-point reposition.

## Key concepts

- **Route edge**: an edge with `x-dialogue.route = {type:"choice", choiceId, outcome, choiceIndex}` in its DATA. Only route edges are colored, splittable, and participate in dialogue routing. **Route must be in edge data, NOT applied as a visual hack at render time** (that was tried and failed — edges looked colored but couldn't be split).
- **Choice port drag**: pointerdown on `.dialogue-canvas-choice-swatch` / `.dialogue-canvas-choice-failure-port` → delegates to `sourceNode.onConnectionPointerdown(event, "right")` for a native floating-end drag. `pendingChoiceRoute` remembers the choice; `onEdgeCreatedFromChoicePort` binds it via `saveRoute`.
- **Edge-split**: double-click a route edge → insert router node at click point, split edge into two route edges (source→router, router→target), both carrying the route binding.
- **Color propagation**: edges dragged FROM a router should inherit the route from an incoming route edge. Implemented in `onEdgeCreatedFromChoicePort` via `findInheritedRoute` → `saveRoute`.

---

## UNSOLVED PROBLEMS (on branch `vn/edge-split-router`)

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

### 3. Edge-split sometimes breaks canvas rendering — MEDIUM

Splitting a **long** edge sometimes corrupts the canvas display (nodes/edges disappear or glitch) until the canvas is reloaded. The single-`importData` rewrite helped but didn't fully fix it.

**Root cause hypothesis:** `removeEdge(clickedEdge)` then `importData` happens while `edge-rendered:after` / `renderRouteEdge` may fire synchronously on the new edges, referencing nodes/edges in a partially-applied state.

**Next steps to try:**
- Defer the entire split operation (removeEdge + importData + selectOnly) into a single `requestAnimationFrame` or `setTimeout(0)` block, so it runs after Obsidian finishes processing the double-click event.
- Or: use `canvas.setData()` (full canvas data replacement) instead of removeEdge + importData — build the complete node+edge list, set it atomically.

### 4. Choice-port drag from OCCUPIED ports — LOW (mostly fixed)

Occupied ports (with route) are dimmed via CSS (`pointer-events: none`) and the capture handler bails. This mostly works. Edge case: if CSS doesn't load or the class isn't applied, the JS guard is the fallback.

### 5. Lag: route edges during pan-over-edge — LOW (deferred)

Panning the canvas with the middle mouse button while the cursor is over an edge causes route edges to lag/drift. This was a pre-existing issue. The geometry-only anchor fix (`getChoiceAnchorGeometric`) and synchronous `edge-rendered:after` rendering helped with drag/resize collapse, but the pan-over-edge lag persists. Our render code is NOT called during pan (logs confirmed), so the lag is likely from Obsidian's native edge re-rendering overwriting our path. May need a viewport-change listener that re-renders routes after pan settles.

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
