/* eslint-disable @typescript-eslint/no-explicit-any -- LLM agent change: Obsidian Canvas internals are partially untyped. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- LLM agent change: Obsidian Canvas internals are partially untyped. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- LLM agent change: Obsidian Canvas internals are partially untyped. */
import { Menu, Notice } from "obsidian"
import { Canvas, CanvasEdge, CanvasNode, Position } from "src/@types/Canvas"
import { Side } from "src/@types/AdvancedJsonCanvas"
import { DialogueFailureRouteData, DialogueNodeData } from "src/@types/DialogueCanvas"
import CanvasHelper from "src/utils/canvas-helper"
import { resolveCssColor, routeToColorCss } from "src/utils/dialogue-route-color"
import CanvasExtension from "./canvas-extension"

type CanvasNodeDataWithDialogue = ReturnType<CanvasNode["getData"]> & {
  id: string
  text?: string
  width?: number
  height?: number
  ["x-dialogue"]?: DialogueNodeData
}

type CanvasEdgeDataWithNodes = ReturnType<CanvasEdge["getData"]> & {
  id: string
  fromNode?: string
  toNode?: string
  ["x-dialogue"]?: { route?: DialogueFailureRouteData }
}

export default class DialogueRouterCanvasExtension extends CanvasExtension {
  // LLM agent change: router node size, halved from 28 to 14 per user request.
  private readonly routerSize = 14
  // LLM agent change: declared without initializer, created at the top of init(). The base
  // constructor calls init() from super() before TS field initializers run. See
  // DialogueChoiceRouteCanvasExtension for the fuller explanation.
  private observedCanvasWrappers!: WeakSet<HTMLElement>
  private menuObserver: MutationObserver | null = null
  private lastContextMenuRequest: { canvas: Canvas, position: Position } | null = null
  private lastInteractionNode: CanvasNode | null = null
  // LLM agent change: remembers the source node of an in-progress edge drag, captured at drag
  // start (edge-connection-dragging:before) and consumed by the native connection-drop-menu
  // handler to decide whether to add our 'Add dialogue frame / route point' items.
  private lastDragSourceNode: CanvasNode | null = null
  // LLM agent change: remembers the native dragged edge itself (E1), captured at drag start. When
  // the drag ends by SPAWNING a node, spawnNodeAtDrop creates a NEW edge (E2) — the native E1 is
  // now a dangling duplicate and must be removed explicitly, otherwise enforceSingleOutgoingEdge
  // sees two outgoing edges and non-deterministically deletes one (often E2 → the spawn edge
  // vanishes). Symmetric with choice-route-ext's choiceDragNativeEdge.
  private lastDragNativeEdge: CanvasEdge | null = null
  // LLM agent change: last canvas-space position where the pointer was released, captured on the
  // active canvas's pointerup. The connection-drop-menu event gives us no coordinates, so we use
  // this to spawn the node where the user dropped.
  private lastDropPosition: Position | null = null

  isEnabled() {
    return true
  }

  init() {
    // LLM agent change: initialize Map/Set fields first (see declaration comment).
    this.observedCanvasWrappers = new WeakSet<HTMLElement>()

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:canvas-changed",
      (canvas: Canvas) => this.ensureCanvasContextMenu(canvas)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "layout-change",
      () => this.ensureAllCanvasContextMenus()
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:node-added",
      (canvas: Canvas, node: CanvasNode) => this.renderRouterNode(canvas, node)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:node-changed",
      (canvas: Canvas, node: CanvasNode) => this.renderRouterNode(canvas, node)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:node-resized",
      (_canvas: Canvas, node: CanvasNode) => {
        if (this.isRouterNode(node)) {
          this.enforceRouterSize(node)
        }
      }
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:node-interaction",
      (canvas: Canvas, node: CanvasNode) => this.updateRouterInteraction(canvas, node)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:selection-changed",
      (canvas: Canvas) => this.onSelectionChanged(canvas)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:edge-created",
      (canvas: Canvas, edge: CanvasEdge) => this.onEdgeChanged(canvas, edge)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:edge-changed",
      (canvas: Canvas, edge: CanvasEdge) => this.onEdgeChanged(canvas, edge)
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:edge-removed",
      (canvas: Canvas, edge: CanvasEdge) => {
        this.onSelectionChanged(canvas)
        // LLM agent change: re-render router nodes that were connected to the removed edge — their
        // color may change (e.g. they lose their only incoming/outgoing → grey warning).
        const edgeData = edge.getData() as CanvasEdgeDataWithNodes
        for (const nodeId of [edgeData.fromNode, edgeData.toNode]) {
          if (!nodeId) {
            continue
          }
          const node = canvas.nodes.get(nodeId)
          if (node && this.isRouterNode(node)) {
            this.renderRouterNode(canvas, node)
          }
        }
      }
    ))

    // LLM agent change: capture the source node AND the native dragged edge of an edge drag at its
    // start, so (a) the native connection-drop-menu handler can add our spawn items only for
    // dialogue-node sources, and (b) spawnNodeAtDrop can remove the native dragged edge (E1) once
    // the spawn creates a proper edge (E2) — see lastDragNativeEdge.
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:edge-connection-dragging:before",
      (canvas: Canvas, edge: CanvasEdge, _event: PointerEvent, newEdge: boolean) => {
        this.lastDragSourceNode = edge?.from?.node ?? null
        // Only a FRESH native drag (newEdge) produces a dangling edge we need to clean up; re-grabbing
        // an existing edge on a move drag would mis-record a non-dangling edge.
        this.lastDragNativeEdge = newEdge ? edge : null
      }
    ))

    // LLM agent change: instead of showing a separate spawn menu (which conflicted with Obsidian's
    // own connection-drop menu), add 'Add dialogue frame' / 'Add dialogue route point' as items in
    // the native drop menu — but only when the drag started from a dialogue node. The drop
    // position is captured from the event below (cursor coords at release).
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "canvas:node-connection-drop-menu",
      (menu: Menu, canvas: Canvas) => {
        const sourceNode = this.lastDragSourceNode
        if (!sourceNode || canvas.readonly || !this.isDialogueNode(sourceNode)) {
          return
        }

        // LLM agent change: clear any choice-drag marker from a previous interaction so it can't
        // suppress this spawn (choice-port drags now support spawn too).
        delete canvas.wrapperEl?.dataset.dialogueChoiceDrag

        const dropPosition = this.lastDropPosition
        if (!dropPosition) {
          return
        }
        const sourceNodeId = sourceNode.getData().id

        menu.addItem(item => {
          item
            .setTitle("Add dialogue frame")
            .setIcon("message-square-plus")
            .onClick(() => this.spawnNodeAtDrop(canvas, sourceNodeId, dropPosition, "frame"))
        })
        menu.addItem(item => {
          item
            .setTitle("Add dialogue route point")
            .setIcon("circle-dot")
            .onClick(() => this.spawnNodeAtDrop(canvas, sourceNodeId, dropPosition, "router"))
        })

        this.lastDragSourceNode = null
      }
    ))

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "layout-change",
      () => this.renderAllRouters()
    ))

    this.ensureMenuObserver()
    this.ensureAllCanvasContextMenus()
    this.renderAllRouters()
  }

  private ensureAllCanvasContextMenus() {
    for (const canvas of this.plugin.getCanvases?.() ?? []) {
      this.ensureCanvasContextMenu(canvas)
    }
  }

  private ensureCanvasContextMenu(canvas: Canvas) {
    const wrapperEl = canvas.wrapperEl

    if (!wrapperEl || this.observedCanvasWrappers.has(wrapperEl)) {
      return
    }

    this.observedCanvasWrappers.add(wrapperEl)

    const onContextMenu = (event: MouseEvent) => {
      if (canvas.readonly) {
        return
      }

      this.lastContextMenuRequest = {
        canvas,
        position: canvas.posFromEvt(event),
      }

      window.setTimeout(() => this.injectRouterMenuItem(), 0)
      window.setTimeout(() => this.injectRouterMenuItem(), 50)
    }

    // LLM agent change: capture the canvas-space position of the last pointer release, so the
    // connection-drop-menu handler can spawn a node where the user dropped the dragged edge.
    const onPointerUp = (event: PointerEvent) => {
      this.lastDropPosition = canvas.posFromEvt(event)
    }

    wrapperEl.addEventListener("contextmenu", onContextMenu)
    wrapperEl.addEventListener("pointerup", onPointerUp)
    this.plugin.register(() => {
      wrapperEl.removeEventListener("contextmenu", onContextMenu)
      wrapperEl.removeEventListener("pointerup", onPointerUp)
    })
  }

  private ensureMenuObserver() {
    if (this.menuObserver) {
      return
    }

    // LLM agent change: observe only direct childList on body, NOT subtree. Obsidian mounts the
    // context menu (.menu) as a direct child of body, so we still detect when it opens — but we
    // no longer fire the callback on every DOM change anywhere in the app (tooltips, hovers,
    // typing, animations), which was the main source of constant CPU usage while idle.
    this.menuObserver = new MutationObserver(() => this.injectRouterMenuItem())
    this.menuObserver.observe(activeDocument.body, {
      childList: true,
    })

    this.plugin.register(() => {
      this.menuObserver?.disconnect()
      this.menuObserver = null
    })
  }

  private injectRouterMenuItem() {
    const request = this.lastContextMenuRequest

    if (!request || request.canvas.readonly) {
      return
    }

    const menuEl = activeDocument.querySelector(".menu")

    if (!(menuEl instanceof HTMLElement)) {
      return
    }

    if (
      menuEl.querySelector("#dialogue-canvas-add-router-point-menu-item") &&
      menuEl.querySelector("#dialogue-canvas-add-frame-menu-item")
    ) {
      return
    }

    const createSectionItem = menuEl.querySelector('[data-section="create"]')

    if (!createSectionItem) {
      return
    }

    const createGroupEl = createSectionItem.closest(".menu-group")

    if (!(createGroupEl instanceof HTMLElement)) {
      return
    }

    if (!menuEl.querySelector("#dialogue-canvas-add-frame-menu-item")) {
      const frameMenuItem = CanvasHelper.createDropdownOptionElement({
        label: "Add dialogue frame",
        icon: "message-square-plus",
        callback: () => {
          this.createDialogueFrameNode(request.canvas, request.position)
          menuEl.remove()
        },
      })
      frameMenuItem.id = "dialogue-canvas-add-frame-menu-item"
      frameMenuItem.dataset.section = "create"
      createGroupEl.appendChild(frameMenuItem)
    }

    if (!menuEl.querySelector("#dialogue-canvas-add-router-point-menu-item")) {
      const routerMenuItem = CanvasHelper.createDropdownOptionElement({
        label: "Add dialogue route point",
        icon: "circle-dot",
        callback: () => {
          this.createRouterNode(request.canvas, request.position)
          menuEl.remove()
        },
      })
      routerMenuItem.id = "dialogue-canvas-add-router-point-menu-item"
      routerMenuItem.dataset.section = "create"
      createGroupEl.appendChild(routerMenuItem)
    }
  }

  // LLM agent change: dialogue frames can be created directly from the canvas context menu.
  private createDialogueFrameNode(canvas: Canvas, position: Position) {
    const node = canvas.createTextNode({
      pos: {
        x: position.x - 180,
        y: position.y - 110,
      },
      size: {
        width: 360,
        height: 220,
      },
    })
    const nodeData = node.getData() as CanvasNodeDataWithDialogue

    const nextData: CanvasNodeDataWithDialogue = {
      ...nodeData,
      text: "",
      width: Math.max(nodeData.width ?? 0, 360),
      height: Math.max(nodeData.height ?? 0, 220),
      "x-dialogue": {
        ...nodeData["x-dialogue"],
        frame: {
          frameId: this.generateFrameId(nodeData.id),
          choices: [],
        },
      },
    }
    // LLM agent change: build the setData payload as a CanvasNodeDataWithDialogue first, so
    // the `text` field (valid on text nodes but absent from the base CanvasNodeData) type-checks.
    node.setData(nextData)
    canvas.selectOnly(node)
    canvas.pushHistory(canvas.getData())
    this.plugin.app.workspace.trigger("advanced-canvas:dialogue-frame-edit-requested", canvas, node)
  }

  // LLM agent change: routing points are transparent dialogue graph helpers, not dialogue frames.
  private createRouterNode(canvas: Canvas, position: Position) {
    const node = canvas.createTextNode({
      pos: {
        x: position.x - this.routerSize / 2,
        y: position.y - this.routerSize / 2,
      },
      size: {
        width: this.routerSize,
        height: this.routerSize,
      },
    })
    const nodeData = node.getData() as CanvasNodeDataWithDialogue

    const nextData: CanvasNodeDataWithDialogue = {
      ...nodeData,
      text: "",
      width: this.routerSize,
      height: this.routerSize,
      "x-dialogue": {
        ...nodeData["x-dialogue"],
        router: {
          type: "point",
        },
      },
    }
    // LLM agent change: see createFrameNode — typed payload so `text` type-checks.
    node.setData(nextData)
    canvas.selectOnly(node)
    canvas.pushHistory(canvas.getData())
    this.renderRouterNode(canvas, node)
  }

  // LLM agent change: when the user drags a brand-new edge from a node and releases it on empty
  // canvas space, offer to spawn a dialogue frame or a route point at the drop location and wire
  // the edge to it. If the source node is a frame with choices, the choice-route extension will
  // LLM agent change: create a frame or router node centered at the drop position, then wire an
  // edge from the source node to it. After wiring, emit dialogue-edge-needs-route so the
  // choice-route extension can prompt for a choice binding (frame source with choices) and open
  // the frame editor for frames.
  private spawnNodeAtDrop(
    _canvas: Canvas | undefined,
    sourceNodeId: string,
    dropPosition: Position,
    kind: "frame" | "router"
  ) {
    // LLM agent change: the canvas captured at menu-show time can be stale by the time the user
    // clicks a menu item (Obsidian may have rebuilt it). Fetch the fresh, live canvas from the
    // plugin instead of trusting the captured one.
    const canvas = this.plugin.getCurrentCanvas()
    if (!canvas?.nodes) {
      return
    }
    const sourceNode = canvas.nodes.get(sourceNodeId)
    if (!sourceNode) {
      return
    }

    // Build the node centered on the drop position.
    const size = kind === "frame"
      ? { width: 360, height: 220 }
      : { width: this.routerSize, height: this.routerSize }

    const node = canvas.createTextNode({
      pos: {
        x: dropPosition.x - size.width / 2,
        y: dropPosition.y - size.height / 2,
      },
      size,
    })
    const nodeData = node.getData() as CanvasNodeDataWithDialogue

    const nextNodeData: CanvasNodeDataWithDialogue = kind === "frame"
      ? {
          ...nodeData,
          text: "",
          width: size.width,
          height: size.height,
          "x-dialogue": {
            ...nodeData["x-dialogue"],
            frame: {
              frameId: this.generateFrameId(nodeData.id),
              choices: [],
            },
          },
        }
      : {
          ...nodeData,
          text: "",
          width: this.routerSize,
          height: this.routerSize,
          "x-dialogue": {
            ...nodeData["x-dialogue"],
            router: { type: "point" },
          },
        }
    node.setData(nextNodeData)

    // Wire the edge from source to the new node. Use the simplest side heuristic: out of the
    // source's right side into the new node's left side. The choice-route extension re-renders
    // edges so any route styling gets applied once a choice is bound.
    const edgeData: CanvasEdgeDataWithNodes = {
      id: `${sourceNodeId}-to-${node.getData().id}`,
      fromNode: sourceNodeId,
      fromSide: "right" as Side,
      toNode: node.getData().id,
      toSide: "left" as Side,
    }
    canvas.importData({ nodes: [], edges: [edgeData] }, false, false)

    // LLM agent change: remove the dangling native dragged edge (E1) now that the spawn has created
    // a proper edge (E2, above). Without this, E1 lingers and enforceSingleOutgoingEdge sees two
    // outgoing edges from the router, then non-deterministically deletes one by id-sort — usually
    // deleting E2 (the spawn edge the user just created), so the spawn looks disconnected.
    if (this.lastDragNativeEdge) {
      const nativeEdge = this.lastDragNativeEdge
      this.lastDragNativeEdge = null
      // Guard against removing E2 itself (same edge object) — shouldn't happen (E2 is freshly
      // imported), but the equality check is cheap insurance.
      const isE2 = nativeEdge.getData().id === edgeData.id
      if (!isE2) {
        canvas.removeEdge(nativeEdge)
      }
    }

    canvas.selectOnly(node)
    canvas.pushHistory(canvas.getData())

    // Give the choice-route extension a chance to prompt for a choice binding.
    const createdEdge = canvas.getEdgesForNode(sourceNode).find(candidate => {
      const data = candidate.getData() as CanvasEdgeDataWithNodes
      return data.toNode === node.getData().id && data.fromNode === sourceNodeId
    })
    if (createdEdge) {
      this.plugin.app.workspace.trigger(
        "advanced-canvas:dialogue-edge-needs-route",
        canvas,
        createdEdge,
        sourceNode,
        // LLM agent change: for frame spawns, let the frame editor open only AFTER route binding
        // succeeds (handled inside onEdgeNeedsRoute/openBindRouteModal). Emitting frame-edit-
        // requested here synchronously would open the editor immediately, leaving it open even if
        // the user cancels the route-binding modal.
        kind === "frame"
      )
    }

    // LLM agent change: mark this node as freshly spawned (with its connecting edge) BEFORE
    // opening any editor / binding modal, so the frame extension can remove both if the user
    // cancels. Applies to both frame and router spawns — both can open the choice-route modal
    // (via dialogue-edge-needs-route below) which the user can cancel.
    if (createdEdge) {
      this.plugin.app.workspace.trigger(
        "advanced-canvas:dialogue-node-spawned",
        canvas,
        node.getData().id,
        createdEdge.getData().id
      )
    }

    // LLM agent change: the frame editor is now opened from inside onEdgeNeedsRoute
    // (choice-route extension) once route binding succeeds — see openFrameEditorAfter above.
    // For router spawns, just render the node.
    if (kind !== "frame") {
      this.renderRouterNode(canvas, node)
    }
  }

  private enforceSingleOutgoingEdge(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithNodes
    const fromNode = edgeData.fromNode ? canvas.nodes.get(edgeData.fromNode) : undefined

    if (!fromNode || !this.isRouterNode(fromNode)) {
      return
    }

    // LLM agent change: a router may have only ONE outgoing edge. When a second appears, keep the
    // one the user JUST acted on (the `edge` argument — the newest) and remove the older ones.
    // Previously this kept the lexicographically-smallest edge id, which was non-deterministic
    // relative to user intent: ids are arbitrary, so the "winner" was effectively random. Now
    // "most recent wins" is explicit and intuitive — the edge just created/changed is the one the
    // user wants; the others were superseded. (The spawn-flow's lastDragNativeEdge cleanup is still
    // needed separately — it removes the dangling native drag edge E1, which is floating and thus
    // filtered out below, never reaching this "competing" set.)
    const keepId = edgeData.id
    const extras: CanvasEdge[] = []
    for (const candidate of canvas.edges.values()) {
      const candidateData = candidate.getData() as CanvasEdgeDataWithNodes
      if (candidateData.fromNode !== edgeData.fromNode) {
        continue
      }
      if (candidateData.id === keepId) {
        continue
      }
      // Ignore edges with a FLOATING 'to' end (drag-in-progress): candidate.to.node is undefined
      // while the user is still dragging the loose end to a target. Counting such an edge here would
      // delete it before it connects. Only fully-connected edges count as "competing" connections.
      // (The edge being kept, `edge`, is exempt from this check — it may itself be mid-drag.)
      if (candidate.to?.node == null) {
        continue
      }
      extras.push(candidate)
    }

    if (extras.length === 0) {
      return
    }

    for (const extraEdge of extras) {
      canvas.removeEdge(extraEdge)
    }

    canvas.pushHistory(canvas.getData())
    new Notice("Dialogue canvas: route point can have only one outgoing edge")
  }

  private onEdgeChanged(canvas: Canvas, edge: CanvasEdge) {
    this.enforceSingleOutgoingEdge(canvas, edge)
    this.syncSelectedRouterInteraction(canvas)
    // LLM agent change: a router node's COLOR depends on its connected edges, so an edge change
    // must re-render the router nodes on both ends (if they are routers). Reads fromNode/toNode
    // from the edge's own data so it works even mid-mutation.
    const edgeData = edge.getData() as CanvasEdgeDataWithNodes
    for (const nodeId of [edgeData.fromNode, edgeData.toNode]) {
      if (!nodeId) {
        continue
      }
      const node = canvas.nodes.get(nodeId)
      if (node && this.isRouterNode(node)) {
        this.renderRouterNode(canvas, node)
      }
    }
  }

  private renderAllRouters() {
    window.setTimeout(() => {
      for (const canvas of this.plugin.getCanvases?.() ?? []) {
        for (const node of canvas.nodes.values()) {
          this.renderRouterNode(canvas, node)
        }
      }
    }, 100)
  }

  // LLM agent change: resolve the color a router NODE should be painted, based on its incoming and
  // outgoing route edges. "Valid" edge = choice (resolvable) OR unbound — both are real, connected
  // route lines. broken/unknown are PROBLEM states (deleted choice / no source) and are NOT valid.
  // Rules:
  //   - 1 valid incoming + 1 valid outgoing of the SAME color → COLORED (that color — the node
  //     "becomes" the single route flowing through it; for unbound that color is grey).
  //   - ≥1 valid incoming AND ≥1 valid outgoing, but colors differ or there are several → WHITE
  //     (valid but ambiguous).
  //   - 0 valid incoming OR 0 valid outgoing (one side empty, or only broken/unknown edges) →
  //     GREY warning (partially connected / problem).
  //   - 0 and 0 (isolated) → GREY (we do NOT auto-delete; user decided to keep isolated nodes).
  // Returns { color: cssString, state: 'colored'|'white'|'warning' }.
  private resolveNodeColor(canvas: Canvas, node: CanvasNode): { color: string; state: "colored" | "white" | "warning" } {
    const nodeId = node.getData().id
    // LLM agent change: store RESOLVED rgb colors (not raw var() strings), because different route
    // types can map to visually-identical colors via different CSS variables (e.g. unknown and
    // unbound are both grey, but --dialogue-route-unknown-color !== --dialogue-route-unbound-color
    // as strings — so a string === check would wrongly call them different and flip the node to
    // white). Resolving to rgb first means "same color to the eye" === "same color to the node".
    const incomingColors: string[] = []
    const outgoingColors: string[] = []

    // LLM agent change: scan only the edges attached to this node (via the native adjacency index),
    // instead of every edge on the canvas. O(attached) instead of O(E).
    for (const edge of this.edgesForNode(canvas, node, "both")) {
      const data = edge.getData() as CanvasEdgeDataWithNodes
      const route = data["x-dialogue"]?.route
      if (!route) {
        continue // default edge — not a route, ignore
      }

      if (data.toNode === nodeId) {
        const color = this.edgeRouteColor(canvas, edge, data, "from")
        if (color) {
          incomingColors.push(color)
        }
      }
      if (data.fromNode === nodeId) {
        const color = this.edgeRouteColor(canvas, edge, data, "from")
        if (color) {
          outgoingColors.push(color)
        }
      }
    }

    const hasIncoming = incomingColors.length > 0
    const hasOutgoing = outgoingColors.length > 0

    if (!hasIncoming || !hasOutgoing) {
      // partially connected OR isolated → grey warning by default. BUT if the one connected side is
      // BROKEN (a deleted choice), paint the node red so the broken state is visible even on a
      // partially-connected router — a red node signals 'this has a broken route', grey would hide it.
      const brokenColor = resolveCssColor("var(--dialogue-route-broken-color)")
      const presentColors = hasIncoming ? incomingColors : outgoingColors
      if (presentColors.length > 0 && presentColors.every(c => c === brokenColor)) {
        return { color: "var(--dialogue-route-broken-color)", state: "colored" }
      }
      // otherwise muted grey warning (partially connected / isolated, or unknown-only).
      return { color: "var(--text-muted)", state: "warning" }
    }

    if (incomingColors.length === 1 && outgoingColors.length === 1 && incomingColors[0] === outgoingColors[0]) {
      return { color: incomingColors[0]!, state: "colored" }
    }

    // valid on both sides but ambiguous → white. Use an actual LIGHT color (not background-primary,
    // which is the dark canvas bg on dark themes and makes the dot invisible).
    return { color: "var(--text-normal)", state: "white" }
  }

  // LLM agent change: compute the RESOLVED rgb CSS color of a route edge, for VALID routes only.
  // "Valid" for node coloring = choice (resolvable), unbound, OR broken — all three carry a concrete
  // color and a broken input should make the node red (matching its broken line). Only unknown is a
  // non-endpoint (no source upstream → the router has no colored route flowing through it → grey
  // warning). So this returns a color for choice/unbound/broken, null for unknown (and default edges).
  private edgeRouteColor(
    canvas: Canvas,
    _edge: CanvasEdge,
    data: CanvasEdgeDataWithNodes,
    _side: "from" | "to"
  ): string | null {
    const route = data["x-dialogue"]?.route
    if (!route) {
      return null // default edge — not a route
    }
    // unknown = no source upstream → not a colored endpoint. (broken IS colored — red.)
    if (route.type === "unknown") {
      return null
    }
    // choice / unbound / broken — all carry a concrete color. Resolve the source frame's choices for
    // a choice route (validate + palette index); for unbound/broken, routeToColorCss maps directly.
    const sourceNode = data.fromNode ? canvas.nodes.get(data.fromNode) : undefined
    const sourceData = sourceNode?.getData() as CanvasNodeDataWithDialogue | undefined
    const sourceChoices = sourceData?.["x-dialogue"]?.frame?.choices ?? []
    if (route.type === "choice" && sourceChoices.length > 0 && !sourceChoices.some(c => c.choiceId === route.choiceId)) {
      return null // choice doesn't resolve against the source frame → effectively broken
    }
    const cssVar = routeToColorCss(route, sourceChoices)
    // Resolve to concrete rgb so visually-equal colors compare equal.
    return resolveCssColor(cssVar)
  }

  private renderRouterNode(canvas: Canvas, node: CanvasNode) {
    const nodeEl = this.getNodeElement(node)

    if (!nodeEl) {
      return
    }

    if (!this.isRouterNode(node)) {
      nodeEl.removeClass("dialogue-canvas-router-node")
      nodeEl.removeClass("dialogue-canvas-router-node-is-selected")
      nodeEl.style.removeProperty("--dialogue-router-color")
      nodeEl.removeAttribute("data-router-state")
      return
    }

    nodeEl.addClass("dialogue-canvas-router-node")
    if (canvas.selection.has(node)) {
      nodeEl.addClass("dialogue-canvas-router-node-is-selected")
    } else {
      nodeEl.removeClass("dialogue-canvas-router-node-is-selected")
    }

    // LLM agent change: paint the node per its incoming/outgoing routes (see resolveNodeColor).
    const { color, state } = this.resolveNodeColor(canvas, node)
    const resolved = resolveCssColor(color)
    nodeEl.style.setProperty("--dialogue-router-color", resolved)
    nodeEl.setAttribute("data-router-state", state)

    this.enforceRouterSize(node)
  }

  // LLM agent change: selected route points are drag-only, while unselected route points keep native edge handles.
  private updateRouterInteraction(canvas: Canvas, node: CanvasNode) {
    this.lastInteractionNode = node
    this.syncRouterSelectionClasses(canvas)
    this.syncSelectedRouterInteraction(canvas)
  }

  private onSelectionChanged(canvas: Canvas) {
    this.syncRouterSelectionClasses(canvas)
    this.syncSelectedRouterInteraction(canvas)
  }

  private syncSelectedRouterInteraction(canvas: Canvas) {
    const interactionEl = canvas.nodeInteractionLayer?.interactionEl

    if (!interactionEl) {
      return
    }

    if (!this.lastInteractionNode || !this.isRouterNode(this.lastInteractionNode)) {
      delete interactionEl.dataset.isDialogueRouter
      delete interactionEl.dataset.isSelectedDialogueRouter
      delete interactionEl.dataset.hasDialogueRouterOutgoingEdge

      // LLM agent change: mark the interaction layer when hovering a dialogue FRAME with choices,
      // so CSS can disable the right-side resize handles on its right edge (where the choice
      // ports live) and let our choice-port drag receive the pointerdown instead.
      if (this.lastInteractionNode && this.isFrameWithChoices(this.lastInteractionNode)) {
        interactionEl.dataset.isDialogueFrame = "true"
      } else {
        delete interactionEl.dataset.isDialogueFrame
      }
      return
    }

    interactionEl.dataset.isDialogueRouter = "true"

    if (canvas.selection.has(this.lastInteractionNode)) {
      interactionEl.dataset.isSelectedDialogueRouter = "true"
    } else {
      delete interactionEl.dataset.isSelectedDialogueRouter
    }

    if (this.hasOutgoingEdge(canvas, this.lastInteractionNode)) {
      interactionEl.dataset.hasDialogueRouterOutgoingEdge = "true"
    } else {
      delete interactionEl.dataset.hasDialogueRouterOutgoingEdge
    }
  }

  private syncRouterSelectionClasses(canvas: Canvas) {
    for (const node of canvas.nodes.values()) {
      if (!this.isRouterNode(node)) {
        continue
      }

      const nodeEl = this.getNodeElement(node)

      if (!nodeEl) {
        continue
      }

      if (canvas.selection.has(node)) {
        nodeEl.addClass("dialogue-canvas-router-node-is-selected")
      } else {
        nodeEl.removeClass("dialogue-canvas-router-node-is-selected")
      }
    }
  }

  private enforceRouterSize(node: CanvasNode) {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue

    if (nodeData.width === this.routerSize && nodeData.height === this.routerSize) {
      return
    }

    node.setData({
      ...nodeData,
      width: this.routerSize,
      height: this.routerSize,
    })
  }

  private hasOutgoingEdge(canvas: Canvas, node: CanvasNode): boolean {
    // LLM agent change: O(1) check via the native edgeFrom index instead of an O(E) scan.
    const outgoing = canvas.edgeFrom.get(node)
    return !!outgoing && outgoing.size > 0
  }

  private isRouterNode(node: CanvasNode): boolean {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    return nodeData["x-dialogue"]?.router?.type === "point"
  }

  // LLM agent change: O(1) lookup of a node's connected edges via Obsidian's native adjacency index
  // (canvas.edgeFrom / canvas.edgeTo / getEdgesForNode), instead of an O(E) scan over all edges.
  // direction: "from" → outgoing, "to" → incoming, "both" → union. Returns [] if not indexed.
  private edgesForNode(canvas: Canvas, node: CanvasNode, direction: "from" | "to" | "both"): CanvasEdge[] {
    if (direction === "both") {
      return canvas.getEdgesForNode(node) ?? []
    }
    const set = direction === "from" ? canvas.edgeFrom.get(node) : canvas.edgeTo.get(node)
    return set ? Array.from(set) : []
  }

  // LLM agent change: true for dialogue frames that actually have choices rendered (so the
  // choice ports exist on the right edge and the right resize handles must be disabled).
  private isFrameWithChoices(node: CanvasNode): boolean {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const choices = nodeData["x-dialogue"]?.frame?.choices
    return Array.isArray(choices) && choices.length > 0
  }

  // LLM agent change: true for dialogue frames and route points — the only nodes the drag-to-spawn
  // menu should be offered from. Plain text/file/group nodes are left to Obsidian's native behavior.
  private isDialogueNode(node: CanvasNode): boolean {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const dialogue = nodeData["x-dialogue"]
    return !!dialogue?.frame || !!dialogue?.router
  }

  private getMenuPosition(canvas: Canvas): Position {
    const pointer = canvas.pointer

    if (pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
      return pointer
    }

    const bbox = canvas.getViewportBBox()

    return {
      x: (bbox.minX + bbox.maxX) / 2,
      y: (bbox.minY + bbox.maxY) / 2,
    }
  }

  private getNodeElement(node: CanvasNode): HTMLElement | null {
    const anyNode = node as any
    const nodeEl = anyNode.nodeEl

    return nodeEl instanceof HTMLElement ? nodeEl : null
  }

  private generateFrameId(seed: string): string {
    const normalized = seed
      .toLowerCase()
      .trim()
      .replace(/<[^>]*>/g, "")
      .replace(/[^a-zа-яё0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")

    return normalized.slice(0, 48) || "frame"
  }
}
