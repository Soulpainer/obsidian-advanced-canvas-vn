/* eslint-disable @typescript-eslint/no-explicit-any -- LLM agent change: Obsidian Canvas internals are partially untyped. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- LLM agent change: Obsidian Canvas internals are partially untyped. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- LLM agent change: Obsidian Canvas internals are partially untyped. */
import { Notice } from "obsidian"
import { Canvas, CanvasEdge, CanvasNode, Position } from "src/@types/Canvas"
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
  private readonly observedCanvasWrappers = new WeakSet<HTMLElement>()
  private menuObserver: MutationObserver | null = null
  private lastContextMenuRequest: { canvas: Canvas, position: Position } | null = null
  private lastInteractionNode: CanvasNode | null = null

  isEnabled() {
    return true
  }

  init() {
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

    wrapperEl.addEventListener("contextmenu", onContextMenu)
    this.plugin.register(() => {
      wrapperEl.removeEventListener("contextmenu", onContextMenu)
    })
  }

  private ensureMenuObserver() {
    if (this.menuObserver) {
      return
    }

    this.menuObserver = new MutationObserver(() => this.injectRouterMenuItem())
    this.menuObserver.observe(activeDocument.body, {
      childList: true,
      subtree: true,
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
