/* eslint-disable @typescript-eslint/no-explicit-any -- LLM agent change: Obsidian Canvas internals are partially untyped. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- LLM agent change: Obsidian Canvas internals are partially untyped. */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- LLM agent change: Obsidian Canvas internals are partially untyped. */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- LLM agent change: Obsidian Canvas internals are partially untyped. */
/* eslint-disable @typescript-eslint/no-unsafe-return -- LLM agent change: Obsidian Canvas internals are partially untyped. */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- LLM agent change: explicit Canvas DOM assertions keep intent visible. */
import { ButtonComponent, Modal, Notice, Setting } from "obsidian"
import { Side } from "src/@types/AdvancedJsonCanvas"
import { Canvas, CanvasEdge, CanvasElement, CanvasNode, Position, Size } from "src/@types/Canvas"
import {
  DialogueChoiceData,
  DialogueChoiceRouteOutcome,
  DialogueEdgeData,
  DialogueFailureRouteData,
  DialogueNodeData,
} from "src/@types/DialogueCanvas"
import CanvasHelper from "src/utils/canvas-helper"
import CanvasExtension from "./canvas-extension"
// LLM agent change: removed imports of EditDialogueFrameModal, DialogueFrameEditorValue and the
// dialogue markdown loaders — they were only used by the deleted openFrameModal()/saveFrame()
// duplicate, which now routes through the shared dialogue-frame-edit-requested event.

type CanvasNodeDataWithDialogue = ReturnType<CanvasNode["getData"]> & {
  id: string
  text?: string
  width?: number
  height?: number
  ["x-dialogue"]?: DialogueNodeData
}

type CanvasEdgeDataWithDialogue = ReturnType<CanvasEdge["getData"]> & {
  id?: string
  label?: string
  fromNode?: string
  toNode?: string
  color?: string
  styleAttributes?: { [key: string]: string | null }
  ["x-dialogue"]?: DialogueEdgeData
}

type DialogueChoiceRouteData = DialogueFailureRouteData & {
  type: "choice"
  choiceId: string
  outcome: DialogueChoiceRouteOutcome
}

class EditDialogueChoiceRouteModal extends Modal {
  private choiceId: string
  private outcome: DialogueChoiceRouteOutcome

  constructor(
    app: any,
    private readonly options: {
      choices: DialogueChoiceData[]
      initialValue?: DialogueChoiceRouteData
      onSubmit: (value: DialogueChoiceRouteData) => void
    }
  ) {
    super(app)

    this.choiceId = options.initialValue?.choiceId ?? options.choices[0]?.choiceId ?? "1"
    this.outcome = options.initialValue?.outcome ?? "success"
  }

  onOpen() {
    const { contentEl } = this

    contentEl.empty()
    contentEl.createEl("h2", { text: "Bind choice route" })

    new Setting(contentEl)
      .setName("Choice")
      .setDesc("Number of the choice inside the source frame.")
      .addDropdown(dropdown => {
        for (const choice of this.options.choices) {
          dropdown.addOption(choice.choiceId, `${choice.choiceId}. ${choice.text}`)
        }

        dropdown
          .setValue(this.choiceId)
          .onChange(value => {
            this.choiceId = value
          })
      })

    new Setting(contentEl)
      .setName("Outcome")
      .setDesc("Success and failure use different anchors and colors.")
      .addDropdown(dropdown => {
        dropdown.addOption("success", "Success")
        dropdown.addOption("failure", "Failure")

        dropdown
          .setValue(this.outcome)
          .onChange(value => {
            this.outcome = value as DialogueChoiceRouteOutcome
          })
      })

    new Setting(contentEl)
      .addButton((button: ButtonComponent) => {
        button
          .setButtonText("Cancel")
          .onClick(() => this.close())
      })
      .addButton((button: ButtonComponent) => {
        button
          .setCta()
          .setButtonText("Save")
          .onClick(() => {
            if (!this.choiceId) {
              new Notice("Dialogue canvas: no choice selected")
              return
            }

            this.options.onSubmit({
              type: "choice",
              choiceId: this.choiceId,
              outcome: this.outcome,
            })
            this.close()
          })
      })
  }

  onClose() {
    this.contentEl.empty()
  }
}

export default class DialogueChoiceRouteCanvasExtension extends CanvasExtension {
  private readonly minFrameContentHeight = 120
  private readonly choicesTopGap = 12
  // LLM agent change: real measured choice-row geometry (border-box, from a rendered node).
  // A row without a failure sub-block is 22px tall; a failure sub-block adds 30px (so a row with
  // failure is 52px). The success port sits at the row's vertical center (CSS top: 50%), so its
  // offset is half the row height (11px without failure, 26px with). The failure port sits 38px
  // from the row top (failTop 28 + half of failH 20). These come from measuring a rendered
  // choice-list and matching against real canvas-Y anchors.
  private readonly choiceRowHeight = 22
  private readonly choiceFailureRowHeight = 30
  private readonly choiceFailureRowCenter = 38
  private readonly choicesBottomPadding = 12
  // LLM agent change: these Maps are declared WITHOUT initializers and created in init().
  // Reason: the CanvasExtension base constructor calls this.init() from within super(), which
  // runs BEFORE TypeScript field initializers (those execute after super() returns). Initializing
  // them inline left them undefined when init() ran scheduleRenderAllCanvases(), crashing on
  // renderFrames.has(). Creating them at the top of init() is the safe ordering.
  private renderFrames!: WeakMap<Canvas, number>
  private activePointerRenderStops!: WeakMap<Canvas, () => void>
  // LLM agent change: choice ports we've already attached a custom drag pointerdown handler to,
  // so re-rendering a node doesn't double-bind. Re-checked against the live DOM on every render.
  private wiredChoicePorts!: WeakSet<HTMLElement>
  // LLM agent change: in-progress choice-drag state. Set on choice-port pointerdown, cleared on
  // pointerup. Holds the temp edge being dragged from a choice port.
  private choiceDrag: {
    canvas: Canvas
    sourceNode: CanvasNode
    choiceId: string
    outcome: DialogueChoiceRouteOutcome
    edge: CanvasEdge
    lastPointerEvent: PointerEvent
  } | null = null

  // LLM agent change: route edges bind to numbered choices stored inside frame nodes.
  isEnabled() {
    return true
  }

  init() {
    // LLM agent change: initialize Map fields first, before any event handler can fire
    // (see the field declaration comment above for why this ordering matters).
    this.renderFrames = new WeakMap<Canvas, number>()
    this.activePointerRenderStops = new WeakMap<Canvas, () => void>()
    this.wiredChoicePorts = new WeakSet<HTMLElement>()

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:popup-menu-created",
      (canvas: Canvas) => this.onPopupMenuCreated(canvas)
    ))

    // LLM agent change: render the route edge SYNCHRONOUSLY on each native edge render, not via
    // the rAF-coalesced scheduleRenderCanvas. Rationale: Obsidian's native edge.render() rewrites
    // the path every time a connected node moves/resizes, and that native path collapses our
    // route geometry. If we render our path one frame later (in rAF), the native render in the
    // following frame overwrites it again, so the user sees the collapsed native path. Rendering
    // synchronously here makes our path the last write in the same frame, so it sticks. This is
    // cheap now that the anchor reads only canvas geometry (no getBoundingClientRect reflow).
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:edge-rendered:after",
      (canvas: Canvas, edge: CanvasEdge) => {
        // LLM agent change: while a choice-drag is in progress, the native edge render would
        // redraw our temp edge back to its data target (currently the source node, looping on
        // itself). Intercept it and re-draw the drag preview path from the choice anchor to the
        // cursor so the drag follows the pointer.
        if (this.choiceDrag && this.choiceDrag.edge === edge) {
          this.drawChoiceDragPath(this.choiceDrag.lastPointerEvent)
          return
        }
        this.renderRouteEdge(canvas, edge)
      }
    ))
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:dialogue-frame-rendered",
      (canvas: Canvas, node: CanvasNode) => this.renderSourceNodeRoutes(canvas, node)
    ))
    const rerender = (canvas: Canvas) => this.scheduleRenderCanvas(canvas)
    this.plugin.registerEvent(this.plugin.app.workspace.on("advanced-canvas:node-changed", rerender))
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:node-moved",
      (canvas: Canvas, node: CanvasNode) => this.renderNodeRoutes(canvas, node)
    ))
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:node-resized",
      (canvas: Canvas, node: CanvasNode) => this.renderNodeRoutes(canvas, node)
    ))
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:edge-connection-dragging:before",
      (canvas: Canvas) => this.renderWhilePointerMoves(canvas)
    ))
    // LLM agent change: when a node is spawned by dragging an edge onto empty space, prompt to
    // bind the new edge to a choice if the source frame has any.
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:dialogue-edge-needs-route",
      (canvas: Canvas, edge: CanvasEdge, sourceNode: CanvasNode) => this.onEdgeNeedsRoute(canvas, edge, sourceNode)
    ))
    this.plugin.registerEvent(this.plugin.app.workspace.on("layout-change", () => this.scheduleRenderAllCanvases()))
    this.plugin.registerEvent(this.plugin.app.workspace.on("active-leaf-change", () => this.scheduleRenderAllCanvases()))

    this.scheduleRenderAllCanvases()
  }

  // LLM agent change: handler for the dialogue-edge-needs-route event. If the drag source is a
  // dialogue frame that has choices, open the choice-binding modal so the freshly created edge
  // becomes a proper route immediately. Edges from non-frame sources or frames without choices
  // are left as plain connections.
  private onEdgeNeedsRoute(canvas: Canvas, edge: CanvasEdge, sourceNode: CanvasNode) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const existingRoute = this.getChoiceRoute(edgeData["x-dialogue"]?.route)

    // LLM agent change: if the edge already has a route (e.g. it was dragged from a choice port),
    // there is nothing to prompt for — just keep the binding and re-render.
    if (existingRoute) {
      this.scheduleRenderCanvas(canvas)
      return
    }

    const sourceNodeData = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choices = sourceNodeData["x-dialogue"]?.frame?.choices ?? []

    if (choices.length === 0) {
      return
    }

    this.openBindRouteModal(canvas, edge)
  }

  private onPopupMenuCreated(canvas: Canvas) {
    const selectedEdges = this.getSelectedEdges(canvas)
    const selectedNodes = this.getSelectedNodes(canvas)

    if (canvas.readonly) {
      return
    }

    if (selectedEdges.length === 1) {
      CanvasHelper.addPopupMenuOption(
        canvas,
        CanvasHelper.createPopupMenuOption({
          id: "dialogue-canvas-bind-choice-route",
          icon: "route",
          label: "Bind Choice Route",
          callback: () => this.openBindRouteModal(canvas, selectedEdges[0]!),
        })
      )
    }

    if (selectedNodes.length === 1) {
      const nodeData = selectedNodes[0]!.getData() as CanvasNodeDataWithDialogue
      const choices = nodeData["x-dialogue"]?.frame?.choices ?? []

      if (choices.length > 0) {
        CanvasHelper.addPopupMenuOption(
          canvas,
          CanvasHelper.createPopupMenuOption({
            id: "dialogue-canvas-add-linked-choice-frame",
            icon: "message-square-plus",
            label: "Add Linked Choice Frame",
            callback: () => this.openAddLinkedFrameModal(canvas, selectedNodes[0]!),
          })
        )
      }
    }
  }

  private openBindRouteModal(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const sourceNode = edgeData.fromNode ? canvas.nodes.get(edgeData.fromNode) : undefined
    const sourceNodeData = sourceNode?.getData() as CanvasNodeDataWithDialogue | undefined
    const choices = sourceNodeData?.["x-dialogue"]?.frame?.choices ?? []

    if (!sourceNode || choices.length === 0) {
      new Notice("Dialogue canvas: source frame has no choices")
      return
    }

    new EditDialogueChoiceRouteModal(this.plugin.app as any, {
      choices,
      initialValue: this.getChoiceRoute(edgeData["x-dialogue"]?.route),
      onSubmit: route => this.saveRoute(canvas, edge, sourceNode, route),
    }).open()
  }

  private saveRoute(
    canvas: Canvas,
    edge: CanvasEdge,
    sourceNode: CanvasNode,
    route: DialogueChoiceRouteData
  ) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const sourceNodeData = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choices = sourceNodeData["x-dialogue"]?.frame?.choices ?? []
    const choiceIndex = choices.findIndex(choice => choice.choiceId === route.choiceId)
    const nextXDialogue: DialogueEdgeData = {
      ...edgeData["x-dialogue"],
      route,
    }

    delete nextXDialogue.answer

    const nextEdgeData: CanvasEdgeDataWithDialogue = {
      ...edgeData,
      color: this.getRouteCanvasColorId(Math.max(choiceIndex, 0)),
      label: "",
      styleAttributes: {
        ...edgeData.styleAttributes,
        path: route.outcome === "failure" ? "short-dashed" : null,
      },
      "x-dialogue": nextXDialogue,
    }
    // LLM agent change: build the setData payload as CanvasEdgeDataWithDialogue first, so the
    // `x-dialogue` field (valid for dialogue edges, absent from base CanvasEdgeData) type-checks.
    edge.setData(nextEdgeData)
    canvas.pushHistory(canvas.getData())
    this.plugin.app.workspace.trigger("advanced-canvas:dialogue-choice-route-changed", canvas, sourceNode)
    this.scheduleRenderCanvas(canvas)
  }

  private openAddLinkedFrameModal(canvas: Canvas, sourceNode: CanvasNode) {
    const sourceNodeData = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choices = sourceNodeData["x-dialogue"]?.frame?.choices ?? []

    if (choices.length === 0) {
      new Notice("Dialogue canvas: source frame has no choices")
      return
    }

    new EditDialogueChoiceRouteModal(this.plugin.app as any, {
      choices,
      onSubmit: route => {
        void this.createLinkedFrame(canvas, sourceNode, route)
      },
    }).open()
  }

  // LLM agent change: this creates a real canvas node, then binds its incoming edge to a frame choice.
  private async createLinkedFrame(
    canvas: Canvas,
    sourceNode: CanvasNode,
    route: DialogueChoiceRouteData
  ) {
    const sourceNodeData = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choiceIndex = Math.max(
      sourceNodeData["x-dialogue"]?.frame?.choices?.findIndex(choice => choice.choiceId === route.choiceId) ?? 0,
      0
    )
    const size = this.getLinkedNodeSize(canvas, sourceNode)
    const pos = {
      x: sourceNode.x + sourceNode.width + 240,
      y: sourceNode.y + Math.max(0, sourceNode.height - size.height) / 2,
    }
    const node = canvas.createTextNode({ pos, size })
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const frameId = this.generateFrameId(nodeData.id)
    const edgeData: CanvasEdgeDataWithDialogue = {
      id: this.generateEdgeId(sourceNode.id, node.id, route),
      fromNode: sourceNode.id,
      fromSide: "right" as Side,
      toNode: node.id,
      toSide: "left" as Side,
      color: this.getRouteCanvasColorId(choiceIndex),
      label: "",
      styleAttributes: {
        path: route.outcome === "failure" ? "short-dashed" : null,
      },
      "x-dialogue": {
        route,
      },
    }

    const nextNodeData: CanvasNodeDataWithDialogue = {
      ...nodeData,
      text: "",
      height: Math.max(nodeData.height ?? size.height, 220),
      "x-dialogue": {
        ...nodeData["x-dialogue"],
        frame: {
          frameId,
          choices: [],
        },
      },
    }
    node.setData(nextNodeData)
    canvas.importData({ nodes: [], edges: [edgeData] }, false, false)
    canvas.selectOnly(node)
    canvas.pushHistory(canvas.getData())
    this.plugin.app.workspace.trigger("advanced-canvas:dialogue-choice-route-changed", canvas, sourceNode)
    this.scheduleRenderCanvas(canvas)

    // LLM agent change: removed the local openFrameModal()/saveFrame() duplicate here.
    // Opening the frame editor now goes through the single shared event, which is handled by
    // DialogueFrameCanvasExtension.openEditFrameModal — that path loads triggers AND persists
    // actions, so editing a freshly created linked frame no longer silently drops them.
    this.plugin.app.workspace.trigger("advanced-canvas:dialogue-frame-edit-requested", canvas, node)
  }

  private scheduleRenderAllCanvases() {
    for (const canvas of this.plugin.getCanvases?.() ?? []) {
      this.scheduleRenderCanvas(canvas)
    }
  }

  private scheduleRenderCanvas(canvas: Canvas) {
    if (this.renderFrames.has(canvas)) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      this.renderFrames.delete(canvas)
      this.renderCanvas(canvas)
    })

    this.renderFrames.set(canvas, frameId)
  }

  // LLM agent change: route anchors follow the pointer while a canvas edge connection is being dragged.
  private renderWhilePointerMoves(canvas: Canvas) {
    this.activePointerRenderStops.get(canvas)?.()

    let animationFrameId: number | null = null
    const render = () => {
      if (animationFrameId !== null) {
        return
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null
        this.renderCanvas(canvas)
      })
    }
    const stop = () => {
      activeDocument.removeEventListener("pointermove", render)
      this.activePointerRenderStops.delete(canvas)

      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }

      this.renderCanvas(canvas)
    }
    this.activePointerRenderStops.set(canvas, stop)

    activeDocument.addEventListener("pointermove", render)
    activeDocument.addEventListener("pointerup", stop, { once: true })
  }

  private renderCanvas(canvas: Canvas) {
    for (const edge of canvas.edges.values()) {
      const edgeData = edge.getData() as CanvasEdgeDataWithDialogue

      if (!this.getChoiceRoute(edgeData["x-dialogue"]?.route)) {
        this.setEdgeLabelVisible(edge, true)
        continue
      }

      this.renderRouteEdge(canvas, edge)
    }
  }

  private renderSourceNodeRoutes(canvas: Canvas, sourceNode: CanvasNode) {
    for (const edge of canvas.edges.values()) {
      const edgeData = edge.getData() as CanvasEdgeDataWithDialogue

      if (edgeData.fromNode !== sourceNode.id || !this.getChoiceRoute(edgeData["x-dialogue"]?.route)) {
        continue
      }

      // LLM agent change: refresh choice edges immediately after their source frame DOM exists.
      this.renderRouteEdge(canvas, edge)
    }

    // LLM agent change: (re)attach custom drag handlers to choice ports on this node. Re-runs on
    // every render because Obsidian can rebuild the node DOM.
    this.wireChoicePortDragHandlers(canvas, sourceNode)
  }

  // LLM agent change: attach a pointerdown handler to each choice port on the node so the user can
  // drag a brand-new edge straight from a specific choice (auto-binding it). Binds on the NODE
  // element in the capture phase and checks whether the pointer landed on a choice port, because
  // Obsidian's native resize handle sits on the right edge (same place as the port) and binds its
  // own pointerdown earlier — a port-only listener never fires. Capture on the common ancestor
  // (the node) runs before the resize handle's target-phase handler.
  private wireChoicePortDragHandlers(canvas: Canvas, sourceNode: CanvasNode) {
    const nodeEl = this.getNodeElement(sourceNode)
    if (!nodeEl || this.wiredChoicePorts.has(nodeEl)) {
      return
    }
    this.wiredChoicePorts.add(nodeEl)

    nodeEl.addEventListener("pointerdown", (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      const portEl = target.closest(".dialogue-canvas-choice-swatch, .dialogue-canvas-choice-failure-port") as HTMLElement | null
      if (!portEl || !nodeEl.contains(portEl)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const choiceId = portEl.dataset.dialogueChoiceId
      const outcome = (portEl.dataset.dialogueChoiceOutcome ?? "success") as DialogueChoiceRouteOutcome
      if (!choiceId) {
        return
      }

      this.startChoiceDrag(canvas, sourceNode, choiceId, outcome, event)
    }, { capture: true })

    const ports = Array.from(nodeEl.querySelectorAll<HTMLElement>(
      ".dialogue-canvas-choice-swatch, .dialogue-canvas-choice-failure-port"
    ))
    for (const portEl of ports) {
      portEl.style.cursor = "crosshair"
    }
  }

  // LLM agent change: drive a custom edge drag starting from a choice port. Creates a temporary
  // edge (toNode = source node) already bound to the choice, draws its path from the choice anchor
  // to the cursor on every pointermove, and on pointerup either re-targets it to the node under
  // the cursor (committing the route) or offers the spawn menu (for empty space).
  private startChoiceDrag(
    canvas: Canvas,
    sourceNode: CanvasNode,
    choiceId: string,
    outcome: DialogueChoiceRouteOutcome,
    startEvent: PointerEvent
  ) {
    if (canvas.readonly) {
      return
    }

    const sourceNodeId = sourceNode.getData().id
    const tempEdgeId = `choice-drag-${sourceNodeId}-${choiceId}-${Date.now()}`
    const choiceIndex = this.getChoiceIndex(sourceNode, choiceId)

    // Create a temp edge already bound to the choice (so route styling applies during the drag).
    // toNode points back at the source for now; we'll rewire on drop.
    const tempEdgeData = {
      id: tempEdgeId,
      fromNode: sourceNodeId,
      fromSide: "right" as Side,
      toNode: sourceNodeId,
      toSide: "right" as Side,
      color: this.getRouteCanvasColorId(Math.max(choiceIndex, 0)),
      ["x-dialogue"]: {
        route: { type: "choice", choiceId, outcome },
      },
    }
    canvas.importData({ nodes: [], edges: [tempEdgeData] }, false, false)

    const edge = canvas.edges.get(tempEdgeId)
    if (!edge) {
      return
    }
    if (outcome === "failure") {
      edge.path.display.setAttr("data-path", "short-dashed")
      edge.path.interaction.setAttr("data-path", "short-dashed")
    }
    this.applyEdgeColor(edge, this.getRouteColorCss(choiceIndex, outcome))

    this.choiceDrag = { canvas, sourceNode, choiceId, outcome, edge, lastPointerEvent: startEvent }

    const onPointerMove = (moveEvent: PointerEvent) => {
      this.choiceDrag = { ...this.choiceDrag!, lastPointerEvent: moveEvent }
      this.drawChoiceDragPath(moveEvent)
    }
    const onPointerUp = (upEvent: PointerEvent) => {
      activeDocument.removeEventListener("pointermove", onPointerMove)
      activeDocument.removeEventListener("pointerup", onPointerUp)
      this.finishChoiceDrag(upEvent)
    }

    activeDocument.addEventListener("pointermove", onPointerMove)
    activeDocument.addEventListener("pointerup", onPointerUp)

    // Draw the initial segment immediately.
    this.drawChoiceDragPath(startEvent)
  }

  private getChoiceIndex(sourceNode: CanvasNode, choiceId: string): number {
    const data = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choices = data["x-dialogue"]?.frame?.choices ?? []
    return choices.findIndex(choice => choice?.choiceId === choiceId)
  }

  private drawChoiceDragPath(event: PointerEvent) {
    const drag = this.choiceDrag
    if (!drag) {
      return
    }
    const cursorPos = drag.canvas.posFromEvt(event)
    const anchor = this.getChoiceAnchor(drag.canvas, drag.sourceNode, drag.choiceId, drag.outcome)
    const path = this.buildBezierPath(anchor, cursorPos, "right", "left")
    drag.edge.path.display.setAttr("d", path)
    drag.edge.path.interaction.setAttr("d", path)
  }

  private finishChoiceDrag(event: PointerEvent) {
    const drag = this.choiceDrag
    this.choiceDrag = null
    if (!drag) {
      return
    }

    const { canvas, sourceNode, choiceId, outcome, edge } = drag
    const dropPos = canvas.posFromEvt(event)
    const targetNode = this.findNodeAt(canvas, dropPos, sourceNode)

    if (targetNode) {
      // Commit the route onto the existing temp edge, rewired to the target node.
      const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
      const targetSide = this.bestSideFor(canvas, targetNode, dropPos)
      const committed: CanvasEdgeDataWithDialogue = {
        ...edgeData,
        toNode: targetNode.getData().id,
        toSide: targetSide,
      }
      edge.setData(committed)
      canvas.pushHistory(canvas.getData())
      this.plugin.app.workspace.trigger("advanced-canvas:dialogue-choice-route-changed", canvas, sourceNode)
      this.scheduleRenderCanvas(canvas)
    } else {
      // Empty space: cancel the choice drag for now (drop-to-spawn from a choice port requires
      // reworking spawnNodeAtDrop to reuse this temp edge — tracked as a follow-up). Remove the
      // dangling temp edge so the canvas stays clean.
      canvas.removeEdge(edge)
      canvas.pushHistory(canvas.getData())
    }
  }

  // LLM agent change: find the topmost node (excluding the source) whose bbox contains a point.
  private findNodeAt(canvas: Canvas, point: Position, exclude: CanvasNode): CanvasNode | null {
    const excludeId = exclude.getData().id
    let hit: CanvasNode | null = null
    for (const node of canvas.nodes.values()) {
      const data = node.getData()
      if (data.id === excludeId) {
        continue
      }
      const x = data.x
      const y = data.y
      const width = data.width
      const height = data.height
      if (x === undefined || y === undefined || width === undefined || height === undefined) {
        continue
      }
      if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) {
        hit = node
      }
    }
    return hit
  }

  // LLM agent change: pick the side of the target node closest to the drop point, so the route
  // enters the node from a sensible side.
  private bestSideFor(canvas: Canvas, targetNode: CanvasNode, point: Position): Side {
    const bbox = targetNode.getBBox()
    const cx = (bbox.minX + bbox.maxX) / 2
    const cy = (bbox.minY + bbox.maxY) / 2
    const dx = point.x - cx
    const dy = point.y - cy
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? "right" : "left"
    }
    return dy > 0 ? "bottom" : "top"
  }

  private renderNodeRoutes(canvas: Canvas, node: CanvasNode) {
    for (const edge of canvas.edges.values()) {
      const edgeData = edge.getData() as CanvasEdgeDataWithDialogue

      if (
        (edgeData.fromNode !== node.id && edgeData.toNode !== node.id) ||
        !this.getChoiceRoute(edgeData["x-dialogue"]?.route)
      ) {
        continue
      }

      // LLM agent change: node moves only refresh directly attached dialogue choice routes.
      this.renderRouteEdge(canvas, edge)
    }
  }

  private renderRouteEdge(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const route = this.getChoiceRoute(edgeData["x-dialogue"]?.route)

    if (!route || !edge.bezier || !edgeData.fromNode) {
      return
    }

    this.setEdgeLabelVisible(edge, false)

    const sourceNode = canvas.nodes.get(edgeData.fromNode)
    const sourceNodeData = sourceNode?.getData() as CanvasNodeDataWithDialogue | undefined
    const choices = sourceNodeData?.["x-dialogue"]?.frame?.choices ?? []
    const choiceIndex = choices.findIndex(choice => choice.choiceId === route.choiceId)

    if (!sourceNode || choiceIndex < 0) {
      return
    }

    const anchor = this.getChoiceAnchor(canvas, sourceNode, route.choiceId, route.outcome)
    const target = this.getEdgeTargetAnchor(canvas, edge, edgeData)
    const path = this.buildBezierPath(anchor, target, edge.from.side, edge.to.side)

    edge.center = {
      x: (anchor.x + target.x) / 2,
      y: (anchor.y + target.y) / 2,
    }
    edge.path.interaction.setAttr("d", path)
    edge.path.display.setAttr("d", path)

    if (route.outcome === "failure") {
      edge.path.display.setAttr("data-path", "short-dashed")
      edge.path.interaction.setAttr("data-path", "short-dashed")
    } else {
      edge.path.display.removeAttribute("data-path")
      edge.path.interaction.removeAttribute("data-path")
    }

    this.applyEdgeColor(edge, this.getRouteColorCss(choiceIndex, route.outcome))
    // LLM agent change: do not re-render the native label from our route renderer; it can recursively trigger edge renders.
    this.setEdgeLabelVisible(edge, false)
  }

  private getChoiceAnchor(
    canvas: Canvas,
    sourceNode: CanvasNode,
    choiceId: string,
    outcome: DialogueChoiceRouteOutcome
  ): Position {
    // LLM agent change: anchor purely from canvas geometry, not from getBoundingClientRect().
    // The viewport-based rect read (posFromClient) was stale during drag/resize — the DOM hadn't
    // re-rendered yet while canvas bbox already reflected the move — which collapsed routes into a
    // point. The target anchor already used getBBox (live geometry); now the source anchor does
    // too, so both track the move synchronously. The geometric layout below is calibrated to the
    // real choice-list CSS (22px rows, 30px failure blocks, 11/38px port centers).
    const sourceNodeData = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choices = sourceNodeData["x-dialogue"]?.frame?.choices ?? []
    return this.getChoiceAnchorGeometric(sourceNode, choices, choiceId, outcome)
  }

  // LLM agent change: geometric anchor for a choice port. Mirrors the choice-list layout
  // (see DialogueFrameCanvasExtension.renderChoices and the .dialogue-canvas-choice-list CSS):
  // the list is anchored to the bottom of the node (8px padding) and stacks choice rows from
  // the top, each row being choiceRowHeight tall with an extra choiceFailureRowHeight block for
  // choices that have checks/conditions. Success port sits at the row's vertical center on the
  // node's right edge; failure port sits in the failure sub-block below it.
  private getChoiceAnchorGeometric(
    sourceNode: CanvasNode,
    choices: DialogueChoiceData[],
    choiceId: string,
    outcome: DialogueChoiceRouteOutcome
  ): Position {
    const bbox = sourceNode.getBBox()
    const nodeRightX = bbox.maxX

    const listBottomPadding = 8
    const listGap = 4

    // LLM agent change: find the row index of the requested choice (choiceId is a 1-based string,
    // but choices[] may have gaps, so match by id rather than position). Then stack the heights of
    // all preceding rows — INCLUDING the gap before this row — to get this row's top offset.
    const targetIndex = choices.findIndex(choice => choice?.choiceId === choiceId)
    if (targetIndex < 0) {
      // Unknown choice — anchor at the right-center of the node as a safe default.
      return { x: nodeRightX, y: (bbox.minY + bbox.maxY) / 2 }
    }

    let rowTopOffset = 0
    for (let index = 0; index < targetIndex; index++) {
      const choice = choices[index]
      if (!choice) {
        continue
      }
      if (index > 0 || targetIndex > 0) {
        rowTopOffset += listGap
      }
      rowTopOffset += this.choiceRowHeight
      if (this.choiceHasFailureSlot(choice)) {
        rowTopOffset += this.choiceFailureRowHeight
      }
    }

    // The list's total height, used to compute its top Y from the node's bottom.
    const listHeight = choices.reduce((total, choice, index) => {
      const gap = index === 0 ? 0 : listGap
      return total + gap + this.choiceRowHeight + (this.choiceHasFailureSlot(choice) ? this.choiceFailureRowHeight : 0)
    }, 0)

    const listTopY = bbox.maxY - listBottomPadding - listHeight

    // LLM agent change: measured row-relative port centers (see constants above). The success
    // port sits at the row's vertical center (CSS top: 50%), so for a row WITHOUT failure it is
    // choiceSuccessRowCenter (11px = half of 22); for a row WITH failure the row is 52px tall
    // (22 + failure block 30) and the center is 26px. The failure port is always 38px from the
    // row top (failTop 28 + half of failH 20).
    const targetChoice = choices[targetIndex]
    const targetRowHeight = this.choiceRowHeight + (targetChoice && this.choiceHasFailureSlot(targetChoice) ? this.choiceFailureRowHeight : 0)
    const yOffsetInRow = outcome === "failure"
      ? this.choiceFailureRowCenter
      : targetRowHeight / 2

    return {
      x: nodeRightX,
      y: listTopY + rowTopOffset + yOffsetInRow,
    }
  }

  private getEdgeTargetAnchor(
    canvas: Canvas,
    edge: CanvasEdge,
    edgeData: CanvasEdgeDataWithDialogue
  ): Position {
    const targetNode = edgeData.toNode ? canvas.nodes.get(edgeData.toNode) : edge.to?.node

    if (!targetNode) {
      return edge.bezier.to
    }

    // LLM agent change: use the live target node bbox, because native bezier points can be stale/collapsed during load and drag.
    const bbox = targetNode.getBBox()

    if (edge.to.side === "left") {
      return { x: bbox.minX, y: (bbox.minY + bbox.maxY) / 2 }
    }

    if (edge.to.side === "right") {
      return { x: bbox.maxX, y: (bbox.minY + bbox.maxY) / 2 }
    }

    if (edge.to.side === "top") {
      return { x: (bbox.minX + bbox.maxX) / 2, y: bbox.minY }
    }

    if (edge.to.side === "bottom") {
      return { x: (bbox.minX + bbox.maxX) / 2, y: bbox.maxY }
    }

    return edge.bezier.to
  }

  private buildBezierPath(from: Position, to: Position, fromSide: string, toSide: string): string {
    const distance = Math.max(80, Math.abs(to.x - from.x) * 0.45)
    const cp1 = this.getControlPoint(from, fromSide, distance)
    const cp2 = this.getControlPoint(to, toSide, distance)

    return `M ${from.x} ${from.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${to.x} ${to.y}`
  }

  private getControlPoint(position: Position, side: string, distance: number): Position {
    if (side === "left") return { x: position.x - distance, y: position.y }
    if (side === "right") return { x: position.x + distance, y: position.y }
    if (side === "top") return { x: position.x, y: position.y - distance }
    if (side === "bottom") return { x: position.x, y: position.y + distance }
    return { x: position.x + distance, y: position.y }
  }

  private applyEdgeColor(edge: CanvasEdge, cssColor: string) {
    const resolvedColor = this.resolveCssColor(cssColor)

    edge.lineGroupEl?.style.setProperty("--canvas-color", resolvedColor)
    edge.lineEndGroupEl?.style.setProperty("--canvas-color", resolvedColor)
    edge.path.display?.setAttr("stroke", resolvedColor)
    edge.path.display?.style.setProperty("stroke", resolvedColor)
    edge.path.interaction?.removeAttribute("stroke")
    edge.path.interaction?.style.removeProperty("stroke")
    edge.fromLineEnd?.el?.querySelector("polygon")?.setAttribute("style", `fill: ${resolvedColor}; stroke: ${resolvedColor};`)
    edge.toLineEnd?.el?.querySelector("polygon")?.setAttribute("style", `fill: ${resolvedColor}; stroke: ${resolvedColor};`)
  }

  private resolveCssColor(cssColor: string): string {
    const probe = activeDocument.createElement("span")
    probe.style.color = cssColor
    activeDocument.body.appendChild(probe)
    const resolvedColor = getComputedStyle(probe).color
    probe.remove()

    return resolvedColor || cssColor
  }

  private getRouteCanvasColorId(choiceIndex: number): `${number}` {
    // LLM agent change: return a template-literal-number type (e.g. "1".."8") so the value
    // satisfies the project's narrow `CanvasColor = \`${number}\` | \`#${string}\`` union
    // without an `as` cast. Obsidian's stored canvas colors are 1-based palette indices.
    return String(choiceIndex % 8 + 1) as `${number}`
  }

  private getRouteColorCss(choiceIndex: number, outcome: DialogueChoiceRouteOutcome): string {
    const colorIndex = choiceIndex % 8 + 1

    if (outcome === "failure") {
      return `var(--dialogue-choice-failure-color-${colorIndex})`
    }

    return `var(--dialogue-choice-color-${colorIndex})`
  }

  private getMinimumNodeHeightForChoices(choices: DialogueChoiceData[]): number {
    if (choices.length === 0) {
      return 0
    }

    const choicesHeight = choices.reduce((total, choice) => {
      return total + this.choiceRowHeight + (this.choiceHasFailureSlot(choice) ? this.choiceFailureRowHeight : 0)
    }, 0)

    return this.minFrameContentHeight + this.choicesTopGap + choicesHeight + this.choicesBottomPadding
  }

  private choiceHasFailureSlot(choice: DialogueChoiceData): boolean {
    return (
      (choice.checks?.items?.length ?? 0) > 0 ||
      (choice.conditions?.items?.length ?? 0) > 0
    )
  }

  private getChoiceRoute(route: DialogueFailureRouteData | undefined): DialogueChoiceRouteData | undefined {
    if (route?.type !== "choice" || !route.choiceId || !route.outcome) {
      return undefined
    }

    return route as DialogueChoiceRouteData
  }

  private getSelectedEdges(canvas: Canvas): CanvasEdge[] {
    return [...canvas.selection].filter((item: CanvasElement) =>
      (item as CanvasEdge).path !== undefined
    ) as CanvasEdge[]
  }

  private getSelectedNodes(canvas: Canvas): CanvasNode[] {
    return [...canvas.selection].filter((item: CanvasElement) => {
      const maybeEdge = item as CanvasEdge
      const maybeNode = item as CanvasNode

      if (maybeEdge.path !== undefined || typeof maybeNode.getData !== "function") {
        return false
      }

      const data = maybeNode.getData() as CanvasNodeDataWithDialogue

      return Boolean(data?.id && data["x-dialogue"]?.frame)
    }) as CanvasNode[]
  }

  private setEdgeLabelVisible(edge: CanvasEdge, visible: boolean) {
    if (!edge.labelElement?.wrapperEl) {
      return
    }

    if (visible) {
      edge.labelElement.wrapperEl.removeClass("dialogue-canvas-hidden-edge-label")
    } else {
      edge.labelElement.wrapperEl.addClass("dialogue-canvas-hidden-edge-label")
    }
  }

  private getLinkedNodeSize(canvas: Canvas, sourceNode: CanvasNode): Size {
    return {
      width: Math.max(sourceNode.width || 0, canvas.config.defaultTextNodeDimensions.width, 360),
      height: Math.max(canvas.config.defaultTextNodeDimensions.height, 220),
    }
  }

  private generateEdgeId(sourceNodeId: string, targetNodeId: string, route: DialogueChoiceRouteData): string {
    return `dialogue-choice-${sourceNodeId}-${route.choiceId}-${route.outcome}-${targetNodeId}`
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

  private getNodeElement(node: CanvasNode): HTMLElement | null {
    const anyNode = node as any
    return anyNode.nodeEl instanceof HTMLElement ? anyNode.nodeEl : null
  }

  private escapeCss(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value)
    }

    return value.replace(/"/g, '\\"')
  }
}
