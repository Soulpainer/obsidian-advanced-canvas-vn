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
  // LLM agent change: set to true on Save so onClose can tell a cancel from a submit (used to
  // clean up freshly-spawned nodes on cancel).
  private wasSubmitted = false

  constructor(
    app: any,
    private readonly options: {
      choices: DialogueChoiceData[]
      initialValue?: DialogueChoiceRouteData
      onSubmit: (value: DialogueChoiceRouteData) => void
      onClose?: (wasSubmitted: boolean) => void
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
            this.wasSubmitted = true
            this.close()
          })
      })
  }

  onClose() {
    this.contentEl.empty()
    this.options.onClose?.(this.wasSubmitted)
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
  // LLM agent change: when a choice-port drag delegates to Obsidian's native onConnectionPointerdown
  // (to get a real floating-end drag), we remember the intended choice+outcome here, and the
  // edge-created listener binds the resulting edge to it automatically.
  private pendingChoiceRoute: {
    sourceNodeId: string
    choiceId: string
    outcome: DialogueChoiceRouteOutcome
  } | null = null
  // LLM agent change: prevents multiple concurrent choice-port drags from spawning multiple drop
  // menus. Set on pointerdown, cleared on pointerup.
  private choiceDragInProgress = false
  // LLM agent change: the native edge created by a choice-port drag (before the user drops). If
  // the drop lands on empty space and a spawn replaces it, this edge is removed.
  private choiceDragNativeEdge: CanvasEdge | null = null

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
        // LLM agent change: re-render synchronously so our path is the last write in the frame
        // (native edge.render rewrites the path on node move/resize). renderRouteEdge handles
        // choice-route edges; renderDefaultEdgeFromFrameRight re-anchors non-route edges leaving
        // a choice frame's right side (otherwise they snap back to the side center).
        this.renderRouteEdge(canvas, edge)
        this.renderDefaultEdgeFromFrameRight(canvas, edge)
      }
    ))
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:dialogue-frame-rendered",
      (canvas: Canvas, node: CanvasNode) => this.renderSourceNodeRoutes(canvas, node)
    ))
    // LLM agent change: when a choice-port drag delegates to the native onConnectionPointerdown
    // (so the user gets a real floating-end drag), the resulting new edge lands here. If we have
    // a pending choice route, bind it to the new edge automatically — no modal.
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:edge-created",
      (canvas: Canvas, edge: CanvasEdge) => this.onEdgeCreatedFromChoicePort(canvas, edge)
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
      (canvas: Canvas, edge: CanvasEdge, sourceNode: CanvasNode, openFrameEditorAfter?: boolean) =>
        this.onEdgeNeedsRoute(canvas, edge, sourceNode, openFrameEditorAfter)
    ))
    this.plugin.registerEvent(this.plugin.app.workspace.on("layout-change", () => this.scheduleRenderAllCanvases()))
    this.plugin.registerEvent(this.plugin.app.workspace.on("active-leaf-change", () => this.scheduleRenderAllCanvases()))

    this.scheduleRenderAllCanvases()
  }

  // LLM agent change: handler for the dialogue-edge-needs-route event. If the drag source is a
  // dialogue frame that has choices, open the choice-binding modal so the freshly created edge
  // becomes a proper route immediately. Edges from non-frame sources or frames without choices
  // are left as plain connections.
  private onEdgeNeedsRoute(canvas: Canvas, edge: CanvasEdge, sourceNode: CanvasNode, openFrameEditorAfter = false) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const existingRoute = this.getChoiceRoute(edgeData["x-dialogue"]?.route)

    // LLM agent change: if the edge already has a route (e.g. it was dragged from a choice port),
    // there is nothing to prompt for — just keep the binding and re-render. If asked to open the
    // frame editor afterwards (spawn flow), do that now since there's no modal to wait on.
    if (existingRoute) {
      this.scheduleRenderCanvas(canvas)
      if (openFrameEditorAfter) {
        const targetNode = edgeData.toNode ? canvas.nodes.get(edgeData.toNode) : undefined
        if (targetNode) {
          this.plugin.app.workspace.trigger("advanced-canvas:dialogue-frame-edit-requested", canvas, targetNode)
        }
      }
      return
    }

    const sourceNodeId = sourceNode.getData().id

    // LLM agent change: if this edge was spawned by a choice-port drag (drop-on-empty → spawn),
    // the choice was already picked by the port. Bind the route directly, remove the dangling
    // native dragged edge, and open the frame editor if requested — no choice-binding modal.
    if (this.pendingChoiceRoute && this.pendingChoiceRoute.sourceNodeId === sourceNodeId) {
      const pending = this.pendingChoiceRoute
      this.pendingChoiceRoute = null
      this.choiceDragInProgress = false

      // Remove the native dragged edge (it pointed nowhere useful — the spawn created a new edge).
      if (this.choiceDragNativeEdge && this.choiceDragNativeEdge !== edge) {
        canvas.removeEdge(this.choiceDragNativeEdge)
      }
      this.choiceDragNativeEdge = null

      const route: DialogueChoiceRouteData = {
        type: "choice",
        choiceId: pending.choiceId,
        outcome: pending.outcome,
      }
      this.saveRoute(canvas, edge, sourceNode, route)

      if (openFrameEditorAfter) {
        const liveCanvas = this.plugin.getCurrentCanvas() ?? canvas
        const liveEdgeData = edge.getData() as CanvasEdgeDataWithDialogue
        const targetNode = liveEdgeData.toNode ? liveCanvas.nodes.get(liveEdgeData.toNode) : undefined
        if (targetNode) {
          this.plugin.app.workspace.trigger("advanced-canvas:dialogue-frame-edit-requested", liveCanvas, targetNode)
        }
      }
      return
    }

    const sourceNodeData = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choices = sourceNodeData["x-dialogue"]?.frame?.choices ?? []

    if (choices.length === 0) {
      // No choices to bind — if the caller wanted the frame editor opened, open it now.
      if (openFrameEditorAfter) {
        const targetNode = edgeData.toNode ? canvas.nodes.get(edgeData.toNode) : undefined
        if (targetNode) {
          this.plugin.app.workspace.trigger("advanced-canvas:dialogue-frame-edit-requested", canvas, targetNode)
        }
      }
      return
    }

    this.openBindRouteModal(canvas, edge, openFrameEditorAfter)
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

  private openBindRouteModal(canvas: Canvas, edge: CanvasEdge, openFrameEditorAfter = false) {
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
      onSubmit: route => {
        this.saveRoute(canvas, edge, sourceNode, route)
        // LLM agent change: in the spawn flow, open the frame editor for the target node AFTER the
        // route is bound (not before, which left an editor open even if the user cancelled binding).
        // Re-read the live edge data (saveRoute may have changed it) and use the fresh canvas — the
        // one captured when the modal opened can be stale by the time the user submits.
        if (openFrameEditorAfter) {
          const liveCanvas = this.plugin.getCurrentCanvas()
          const liveEdgeData = edge.getData() as CanvasEdgeDataWithDialogue
          const targetId = liveEdgeData.toNode
          const targetNode = targetId && liveCanvas ? liveCanvas.nodes.get(targetId) : undefined
          if (targetNode && liveCanvas) {
            this.plugin.app.workspace.trigger("advanced-canvas:dialogue-frame-edit-requested", liveCanvas, targetNode)
          }
        }
      },
      // LLM agent change: if the user cancels binding a route to a freshly-spawned node, tell the
      // frame extension to remove the node + edge.
      onClose: wasSubmitted => {
        if (!wasSubmitted) {
          this.plugin.app.workspace.trigger(
            "advanced-canvas:dialogue-spawn-cancel",
            canvas,
            edge.getData().id
          )
        }
      },
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
        // LLM agent change: default (non-route) edges that leave a choice frame from its right
        // side are re-anchored to the upper quarter of that side, where the visible default
        // connection point lives (the choice ports occupy the lower part). Without this the line
        // would start at the side center while the dot shows at the top — out of sync.
        this.renderDefaultEdgeFromFrameRight(canvas, edge)
        continue
      }

      this.renderRouteEdge(canvas, edge)
    }
  }

  // LLM agent change: re-anchor a non-route edge that leaves a dialogue frame with choices from
  // its right side, so the line starts at the upper quarter of the right edge (matching the
  // shifted default connection point) instead of the geometric center.
  private renderDefaultEdgeFromFrameRight(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    // LLM agent change: only re-anchor DEFAULT edges (no route). Route edges have their own anchor
    // (getChoiceAnchor) handled by renderRouteEdge; re-anchoring them here collapsed all routes to
    // the upper-quarter point.
    if (this.getChoiceRoute(edgeData["x-dialogue"]?.route)) {
      return
    }
    if (edgeData.fromSide !== "right" || !edge.bezier || !edgeData.fromNode) {
      return
    }

    const sourceNode = canvas.nodes.get(edgeData.fromNode)
    if (!sourceNode) {
      return
    }
    const sourceNodeData = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choices = sourceNodeData["x-dialogue"]?.frame?.choices
    if (!Array.isArray(choices) || choices.length === 0) {
      return
    }

    const anchor = this.getFrameRightDefaultAnchor(sourceNode)
    const target = this.getEdgeTargetAnchor(canvas, edge, edgeData)
    const path = this.buildBezierPath(anchor, target, "right", edge.to.side)

    edge.path.display.setAttr("d", path)
    edge.path.interaction.setAttr("d", path)
  }

  // LLM agent change: anchor at the upper quarter of a frame's right edge (matches the CSS-shifted
  // default connection point at top: 25%).
  private getFrameRightDefaultAnchor(sourceNode: CanvasNode): Position {
    const bbox = sourceNode.getBBox()
    return {
      x: bbox.maxX,
      y: bbox.minY + (bbox.maxY - bbox.minY) * 0.25,
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

  // LLM agent change: attach a capture-phase pointerdown handler on the canvas wrapper so a drag
  // starting from a choice port starts a route drag instead of a node resize. Binds on the
  // wrapper (the highest ancestor that still lets us resolve which canvas node the port belongs
  // to), because Obsidian's resize handle is bound on the node/interaction layer and would
  // otherwise swallow the pointerdown before any node-level listener runs. Capture on the
  // wrapper fires first.
  private wireChoicePortDragHandlers(canvas: Canvas, sourceNode: CanvasNode) {
    const wrapperEl = canvas.wrapperEl
    if (!wrapperEl || this.wiredChoicePorts.has(wrapperEl)) {
      return
    }
    this.wiredChoicePorts.add(wrapperEl)

    wrapperEl.addEventListener("pointerdown", (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      const portEl = target.closest(".dialogue-canvas-choice-swatch, .dialogue-canvas-choice-failure-port") as HTMLElement | null
      if (!portEl || !wrapperEl.contains(portEl)) {
        return
      }

      const nodeEl = portEl.closest(".canvas-node") as HTMLElement | null
      if (!nodeEl) {
        return
      }
      const sourceNode = this.findNodeByDomEl(canvas, nodeEl)
      if (!sourceNode) {
        return
      }

      const choiceId = portEl.dataset.dialogueChoiceId
      const outcome = (portEl.dataset.dialogueChoiceOutcome ?? "success") as DialogueChoiceRouteOutcome
      if (!choiceId) {
        return
      }

      // LLM agent change: stop the event from reaching Obsidian's own handlers (node drag, inline
      // edit), but do NOT preventDefault — we pass this same event to onConnectionPointerdown, and
      // Obsidian may bail if defaultPrevented is true (drag never starts for empty ports).
      event.stopPropagation()

      this.startChoiceDrag(canvas, sourceNode, choiceId, outcome, event)
    }, { capture: true })

    const ports = Array.from(wrapperEl.querySelectorAll<HTMLElement>(
      ".dialogue-canvas-choice-swatch, .dialogue-canvas-choice-failure-port"
    ))
    for (const portEl of ports) {
      portEl.style.cursor = "crosshair"
    }
  }

  // LLM agent change: resolve a canvas node by its DOM element (matches nodeEl by identity).
  private findNodeByDomEl(canvas: Canvas, nodeEl: HTMLElement): CanvasNode | null {
    for (const node of canvas.nodes.values()) {
      if (node.nodeEl === nodeEl) {
        return node
      }
    }
    return null
  }

  // LLM agent change: start a route drag from a choice port by delegating to Obsidian's NATIVE
  // node.onConnectionPointerdown. This gives the user a real floating-end drag (the edge's free
  // end follows the cursor, snaps to nodes, supports drop-to-spawn via the native menu) — instead
  // of the previous temp-edge-on-self approach, which was stuck anchored to the source node.
  // We remember the intended choice+outcome in pendingChoiceRoute, and onEdgeCreatedFromChoicePort
  // binds the resulting edge to it once the native drag creates it.
  private startChoiceDrag(
    _canvas: Canvas,
    sourceNode: CanvasNode,
    choiceId: string,
    outcome: DialogueChoiceRouteOutcome,
    startEvent: PointerEvent
  ) {
    // LLM agent change: block concurrent choice-port drags — otherwise each port click stacked
    // another native drag + drop menu.
    if (this.choiceDragInProgress) {
      return
    }
    this.choiceDragInProgress = true

    // LLM agent change: mark the canvas wrapper so the router extension can skip its spawn-menu
    // items (drop-to-empty isn't supported for choice drags). Set directly here — earlier this
    // was done in the edge-connection-dragging:before handler, but that fires too late relative
    // to the connection-drop-menu, so the flag was missing.
    const wrapperEl = sourceNode.canvas?.wrapperEl
    if (wrapperEl) {
      wrapperEl.dataset.dialogueChoiceDrag = "true"
    }

    const reset = () => {
      // LLM agent change: do NOT clear choiceDragInProgress here. The native connection-drop
      // menu fires AFTER pointerup, and the router reads canvas.wrapperEl.dataset.dialogueChoiceDrag
      // to skip its spawn items. We clear the flag (and the dataset) in onEdgeCreatedFromChoicePort
      // LLM agent change: do NOT clear pendingChoiceRoute or choiceDragInProgress here.
      // The connection-drop-menu fires AFTER pointerup, and the spawn flow (spawnNodeAtDrop →
      // dialogue-edge-needs-route → onEdgeNeedsRoute) consumes pendingChoiceRoute there.
      // If we cleared here, the spawn flow would lose the choice binding.
      activeDocument.removeEventListener("pointerup", reset)
    }
    activeDocument.addEventListener("pointerup", reset)

    this.pendingChoiceRoute = {
      sourceNodeId: sourceNode.getData().id,
      choiceId,
      outcome,
    }

    // Delegate to the native connection drag from the source node's right side. This is the same
    // call Obsidian makes when the user drags from the right connection point.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- onConnectionPointerdown exists on CanvasNode at runtime
    ;(sourceNode as any).onConnectionPointerdown?.(startEvent, "right")
  }

  // LLM agent change: bind a newly-created edge to the pending choice route (if any), instead of
  // leaving it as a plain edge that would later open the choice-binding modal.
  private onEdgeCreatedFromChoicePort(canvas: Canvas, edge: CanvasEdge) {
    const pending = this.pendingChoiceRoute
    if (!pending) {
      return
    }

    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    if (edgeData.fromNode !== pending.sourceNodeId) {
      // Not the edge from our drag (e.g. an unrelated edge was created) — leave the pending intact
      // in case ours arrives next.
      return
    }

    // LLM agent change: bind the route to this native dragged edge (drop on target case). Do NOT
    // consume pendingChoiceRoute — keep it alive so the spawn flow (drop on empty) can also use it.
    // If a spawn happens, onEdgeNeedsRoute will remove this native edge and bind the spawn edge.
    this.choiceDragNativeEdge = edge

    const sourceNode = canvas.nodes.get(pending.sourceNodeId)
    if (sourceNode) {
      const route: DialogueChoiceRouteData = {
        type: "choice",
        choiceId: pending.choiceId,
        outcome: pending.outcome,
      }
      this.saveRoute(canvas, edge, sourceNode, route)
    }
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
