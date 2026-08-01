# VN Canvas — Agent Handoff (current state: branch `vn/edge-split-router`)

## What this plugin is

A fork of obsidian-advanced-canvas, stripped to a **visual-novel dialogue graph editor**. Plugin id `vn-canvas`, deployed to `<vault>/.obsidian/plugins/vn-canvas/` via `npm run deploy`. Canvas nodes = dialogue frames, edges = routes. Data in `.canvas` files + `Dialogue/*.md` tables (Characters/Stats/Properties/Triggers), read by a Unity runtime.

Branches:
- `main` — upstream Advanced Canvas.
- `new-logic` — VN fork base.
- `vn/dialogue-fixes` — stable: TS fixes, rebrand, upstream cleanup, choice-anchor geometry, CPU fixes, drag-to-spawn, choice-port drag (delegates to native onConnectionPointerdown), occupied-port lock, spawn-cancel cleanup, sequential modal opening (choice → frame).
- `vn/edge-split-router` (CURRENT) — edge-split feature (double-click route edge → insert router node), color propagation, selection fixes. **Unstable / WIP.**

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

### 1. Router-node selection doesn't work (Delete broken) — HIGH

After edge-split creates a router node, `canvas.selectOnly(routerNode)` is called, but the node is **not properly selected** — Delete/Backspace doesn't remove it. The node looks highlighted but isn't in `canvas.selection` in a way Obsidian's delete handler accepts.

**What was tried:**
- `selectOnly` synchronously after `importData` — no effect.
- `selectOnly` via `setTimeout(0)` — no effect.
- `selectOnly` via `requestAnimationFrame` — no effect.
- `createTextNode` instead of `importData` for the router node — the current approach, still broken.
- `updateSelection(() => { deselectAll; selection.add(node) })` — **broke the entire canvas rendering** (reverted).

**Key observation:** `createRouterNode` in `dialogue-router-canvas-extension.ts` (line ~350) does `canvas.selectOnly(node)` after `createTextNode` + `setData`, and it works there. The difference: in edge-split, we also call `removeEdge` + `importData` for the two new edges between `createTextNode` and `selectOnly`. One of those operations likely clears/invalidates selection.

**Next steps to try:**
- Reorder: `selectOnly` BEFORE `removeEdge`/`importData`.
- Or: don't use `selectOnly` at all; instead simulate a click on the node element (`node.nodeEl.dispatchEvent(new MouseEvent(...))`).
- Or: check if `createTextNode` returns a node whose `nodeEl` is already in the DOM and selectable — maybe the issue is the node isn't fully rendered when selectOnly is called.
- Compare with `spawnNodeAtDrop` in router-ext which also creates a node + edges and may or may not select — does Delete work there?

### 2. Edges dragged from router are grey / can't be split — HIGH

When dragging a new edge FROM a router node (via its native connection point), the edge is **grey** (no route), and double-click doesn't split it.

`onEdgeCreatedFromChoicePort` should inherit the route from an incoming edge via `findInheritedRoute` → `saveRoute`. But it's **not working**. Possible reasons:
- `onEdgeCreatedFromChoicePort` may not fire for edges created from a router's connection point (only fires for choice-port drags that set `pendingChoiceRoute`).
- The `edge-created` event from the patcher may not carry enough info to distinguish "dragged from router" vs "dragged from frame".
- `findInheritedRoute` may not find the incoming edge (timing — the incoming edge may not be in `canvas.edges` yet when the new edge is created).

**Next steps to try:**
- Add a temporary `console.log` in `onEdgeCreatedFromChoicePort` to confirm it fires when dragging from a router.
- Check if `edge-created` event fires at all for router-originated drags (vs only for choice-port drags).
- If the event doesn't fire: hook into `node-changed` or `edge-changed` instead, or add a `pointerdown` listener on router nodes (like choice ports) that delegates to `onConnectionPointerdown` and sets a `pendingRouterInherit` flag.

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
