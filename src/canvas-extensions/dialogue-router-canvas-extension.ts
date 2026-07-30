/* eslint-disable @typescript-eslint/no-explicit-any -- LLM agent change: Obsidian Canvas internals are partially untyped. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- LLM agent change: Obsidian Canvas internals are partially untyped. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- LLM agent change: Obsidian Canvas internals are partially untyped. */
import { Menu, Notice } from "obsidian"
import { Canvas, CanvasEdge, CanvasNode, Position } from "src/@types/Canvas"
import { Side } from "src/@types/AdvancedJsonCanvas"
import { DialogueNodeData } from "src/@types/DialogueCanvas"
import CanvasHelper from "src/utils/canvas-helper"
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
}

export default class DialogueRouterCanvasExtension extends CanvasExtension {
  private readonly routerSize = 28
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
      (canvas: Canvas) => this.onSelectionChanged(canvas)
    ))

    // LLM agent change: capture the source node of an edge drag at its start, so the native
    // connection-drop-menu handler can add our spawn items only for dialogue-node sources.
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:edge-connection-dragging:before",
      (canvas: Canvas, edge: CanvasEdge) => {
        this.lastDragSourceNode = edge?.from?.node ?? null
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

        // LLM agent change: a drag started from a choice port marks the canvas wrapper
        // (data-dialogue-choice-drag). Drop-to-empty isn't supported for choice drags (it
        // conflicts with the native dragged edge), so don't add the spawn items — the menu
        // will be empty and won't show.
        if (canvas.wrapperEl?.dataset.dialogueChoiceDrag === "true") {
          this.lastDragSourceNode = null
          // LLM agent change: clear the marker now that the drop-menu has run, so a subsequent
          // normal drag isn't wrongly suppressed.
          delete canvas.wrapperEl.dataset.dialogueChoiceDrag
          return
        }

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
        sourceNode
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

    // For frames, open the editor (mirrors createDialogueFrameNode). Routers render via the
    // node-added/node-changed listeners.
    if (kind === "frame") {
      this.plugin.app.workspace.trigger("advanced-canvas:dialogue-frame-edit-requested", canvas, node)
    } else {
      this.renderRouterNode(canvas, node)
    }
  }

  private enforceSingleOutgoingEdge(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithNodes
    const fromNode = edgeData.fromNode ? canvas.nodes.get(edgeData.fromNode) : undefined

    if (!fromNode || !this.isRouterNode(fromNode)) {
      return
    }

    const outgoingEdges = [...canvas.edges.values()]
      .filter(candidate => {
        const candidateData = candidate.getData() as CanvasEdgeDataWithNodes
        return candidateData.fromNode === edgeData.fromNode
      })
      .sort((a, b) => {
        const aId = (a.getData() as CanvasEdgeDataWithNodes).id
        const bId = (b.getData() as CanvasEdgeDataWithNodes).id
        return aId.localeCompare(bId)
      })

    if (outgoingEdges.length <= 1) {
      return
    }

    for (const extraEdge of outgoingEdges.slice(1)) {
      canvas.removeEdge(extraEdge)
    }

    canvas.pushHistory(canvas.getData())
    new Notice("Dialogue canvas: route point can have only one outgoing edge")
  }

  private onEdgeChanged(canvas: Canvas, edge: CanvasEdge) {
    this.enforceSingleOutgoingEdge(canvas, edge)
    this.syncSelectedRouterInteraction(canvas)
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

  private renderRouterNode(canvas: Canvas, node: CanvasNode) {
    const nodeEl = this.getNodeElement(node)

    if (!nodeEl) {
      return
    }

    if (!this.isRouterNode(node)) {
      nodeEl.removeClass("dialogue-canvas-router-node")
      nodeEl.removeClass("dialogue-canvas-router-node-is-selected")
      return
    }

    nodeEl.addClass("dialogue-canvas-router-node")
    if (canvas.selection.has(node)) {
      nodeEl.addClass("dialogue-canvas-router-node-is-selected")
    } else {
      nodeEl.removeClass("dialogue-canvas-router-node-is-selected")
    }
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
    for (const edge of canvas.edges.values()) {
      const edgeData = edge.getData() as CanvasEdgeDataWithNodes

      if (edgeData.fromNode === node.id) {
        return true
      }
    }

    return false
  }

  private isRouterNode(node: CanvasNode): boolean {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    return nodeData["x-dialogue"]?.router?.type === "point"
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
