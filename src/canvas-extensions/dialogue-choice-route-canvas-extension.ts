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
  DialogueBrokenRouteData,
  DialogueFailureRouteData,
  DialogueNodeData,
  DialogueUnboundRouteData,
  DialogueUnknownRouteData,
} from "src/@types/DialogueCanvas"
import CanvasHelper from "src/utils/canvas-helper"
import { getRouteColorCss, resolveCssColor } from "src/utils/dialogue-route-color"
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

// LLM agent change: any route (choice, unbound, broken, OR unknown). Used where we care "is this a
// route edge at all" regardless of whether it's bound to a specific choice or in a valid state.
type DialogueRouteData =
  | DialogueChoiceRouteData
  | DialogueUnboundRouteData
  | DialogueBrokenRouteData
  | DialogueUnknownRouteData

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
  // LLM agent change: rAF-coalesced pending router-transit recomputes, one per canvas. Coalesces
  // the many edge-changed events that fire during a drag/move into a single recompute pass that
  // runs against the settled graph state. Created in init() for the same ordering reason as above.
  private recomputeFrames!: WeakMap<Canvas, number>
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
    this.recomputeFrames = new WeakMap<Canvas, number>()
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
    // LLM agent change: recompute router-transit colors reactively. When an edge is added, removed,
    // or its route changes, a router whose incoming/outgoing set changed may need its outgoing
    // edges recolored (and the change may cascade downstream). The cascade is guarded by a visited
    // set so cycles in the router graph are safe.
    const recomputeAffected = (canvas: Canvas, edge: CanvasEdge) => this.onEdgeRouteAffected(canvas, edge)
    this.plugin.registerEvent(this.plugin.app.workspace.on("advanced-canvas:edge-created", recomputeAffected))
    this.plugin.registerEvent(this.plugin.app.workspace.on("advanced-canvas:edge-removed", recomputeAffected))
    this.plugin.registerEvent(this.plugin.app.workspace.on("advanced-canvas:edge-changed", recomputeAffected))
    // LLM agent change: double-clicking a route edge inserts a route node at the click point,
    // splitting the edge into two (source→router, router→target) so the route styling is preserved.
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:double-click",
      (canvas: Canvas, event: MouseEvent, preventDefault: { value: boolean }) =>
        this.onEdgeDoubleClick(canvas, event, preventDefault)
    ))
    const rerender = (canvas: Canvas) => this.scheduleRenderCanvas(canvas)
    // LLM agent change: recompute router-transit colors when a node changes. A frame's choices can
    // change (choice added/deleted/renamed) via the frame editor without touching any edge — so
    // edge-changed never fires and the cascade would otherwise NOT re-evaluate validity. This is
    // the fix for "deleting a choice left the inherited line colored" — the router's outgoing edge
    // must now become BROKEN (choiceId gone) or UNKNOWN (all choices gone), reactively.
    const recompute = (canvas: Canvas) => this.scheduleRecomputeAllRouters(canvas)
    this.plugin.registerEvent(this.plugin.app.workspace.on("advanced-canvas:node-changed", (canvas: Canvas) => {
      rerender(canvas)
      recompute(canvas)
    }))
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

    // LLM agent change: this modal is reached from onEdgeNeedsRoute, which only fires for a
    // FRESHLY-SPAWNED edge (spawn flow). So a cancel here SHOULD remove the just-created edge.
    this.openBindRouteModal(canvas, edge, openFrameEditorAfter, true)
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

  private openBindRouteModal(canvas: Canvas, edge: CanvasEdge, openFrameEditorAfter = false, isFreshSpawn = false) {
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
      // LLM agent change: if the user cancels binding a route to a FRESHLY-SPAWNED node, tell the
      // frame extension to remove the node + edge. But if this modal was opened from the "Bind
      // Choice Route" context menu on an EXISTING edge (isFreshSpawn=false), cancelling must NOT
      // delete the line — the edge existed before and the user is just editing/not-binding.
      onClose: wasSubmitted => {
        if (!wasSubmitted && isFreshSpawn) {
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
    // LLM agent change (#2 fix): never mutate route data on a readonly canvas. This is called from
    // the bind-route modal, onEdgeNeedsRoute, onEdgeCreatedFromChoicePort, and createLinkedFrame —
    // none of which should write on a locked canvas.
    if (canvas.readonly) {
      return
    }
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const sourceNodeData = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choices = sourceNodeData["x-dialogue"]?.frame?.choices ?? []
    let choiceIndex = choices.findIndex(choice => choice.choiceId === route.choiceId)
    // LLM agent change: cache the choice index in the route data so renderRouteEdge can apply the
    // correct color even when the edge's fromNode is a router (which has no choices). When the
    // source is a router, choices is [] so findIndex returns -1 — preserve the choiceIndex that was
    // already cached on the route (by a prior saveRoute or an edge-split) instead of forcing 0,
    // which would mis-color inherited router-originated edges blue.
    if (choiceIndex < 0 && route.choiceIndex !== undefined) {
      choiceIndex = route.choiceIndex
    }
    const routeWithIndex = { ...route, choiceIndex: Math.max(choiceIndex, 0) }
    const nextXDialogue: DialogueEdgeData = {
      ...edgeData["x-dialogue"],
      route: routeWithIndex,
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
    if (canvas.readonly) {
      // LLM agent change: don't persist route changes on a readonly canvas (the broken-validation
      // below calls setData). Only render.
      this.renderCanvasReadOnly(canvas)
      return
    }
    for (const edge of canvas.edges.values()) {
      const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
      const route = this.getRoute(edgeData["x-dialogue"]?.route)

      if (!route) {
        // LLM agent change: this is a DEFAULT (non-route) edge. If it used to be a route edge and
        // carries a stale palette color, clear it so the line isn't drawn in a choice color that no
        // longer corresponds to anything (e.g. a frame→router edge whose choice was deleted → its
        // route was dropped but edge.color remained). A dialogue-node default edge should be neutral.
        if (edgeData.color) {
          const cleared: CanvasEdgeDataWithDialogue = { ...edgeData, color: undefined }
          edge.setData(cleared)
        }
        this.setEdgeLabelVisible(edge, true)
        // LLM agent change: default (non-route) edges that leave a choice frame from its right
        // side are re-anchored to the upper quarter of that side, where the visible default
        // connection point lives (the choice ports occupy the lower part). Without this the line
        // would start at the side center while the dot shows at the top — out of sync.
        this.renderDefaultEdgeFromFrameRight(canvas, edge)
        continue
      }

      // LLM agent change: validate choice routes whose fromNode is a FRAME. If the choice was
      // deleted from the frame, PERSIST the route as broken (red dashed) — not just render it
      // broken. Otherwise native Obsidian re-applies the stale edge.color (palette) on its own
      // re-render and the line stays blue despite our renderRouteEdge painting it red. Persisting
      // {type:"broken"} into the data makes both our renderer AND native agree it's broken.
      if (route.type === "choice" && edgeData.fromNode) {
        const fromNode = canvas.nodes.get(edgeData.fromNode)
        const fromData = fromNode?.getData() as CanvasNodeDataWithDialogue | undefined
        const choices = fromData?.["x-dialogue"]?.frame?.choices
        if (choices && !choices.some(choice => choice.choiceId === route.choiceId)) {
          // choice gone → persist broken
          const nextXDialogue = { ...edgeData["x-dialogue"], route: { type: "broken" as const } }
          const nextEdgeData: CanvasEdgeDataWithDialogue = {
            ...edgeData,
            label: "",
            styleAttributes: { ...edgeData.styleAttributes, path: null },
            "x-dialogue": nextXDialogue,
          }
          edge.setData(nextEdgeData)
        }
      }

      this.renderRouteEdge(canvas, edge)
    }
  }

  // LLM agent change: read-only render path — same as renderCanvas but never calls setData (the
  // broken-validation persistence above mutates data, which a locked canvas must not allow).
  private renderCanvasReadOnly(canvas: Canvas) {
    for (const edge of canvas.edges.values()) {
      const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
      if (!this.getRoute(edgeData["x-dialogue"]?.route)) {
        this.setEdgeLabelVisible(edge, true)
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
    if (this.getRoute(edgeData["x-dialogue"]?.route)) {
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

      if (edgeData.fromNode !== sourceNode.id || !this.getRoute(edgeData["x-dialogue"]?.route)) {
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
        // LLM agent change: not a choice port — clear any leftover pending route so it doesn't
        // leak into the next default-point drag (e.g. user clicked a port earlier, then drags
        // from the node's default connection point).
        this.pendingChoiceRoute = null
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

      // LLM agent change: don't start a drag from an already-bound port (one that already has a
      // route edge). The route-port CSS class is added during render when linkedRoutes has it.
      if (portEl.classList.contains("dialogue-canvas-choice-route-port")) {
        event.stopPropagation()
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
    // LLM agent change: mark the canvas wrapper so the router extension can skip its spawn-menu
    // items (drop-to-empty isn't supported for choice drags). Set directly here — earlier this
    // was done in the edge-connection-dragging:before handler, but that fires too late relative
    // to the connection-drop-menu, so the flag was missing.
    const wrapperEl = sourceNode.canvas?.wrapperEl
    if (wrapperEl) {
      wrapperEl.dataset.dialogueChoiceDrag = "true"
    }

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
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue

    // LLM agent change: if the edge came from a choice-port drag (pending set), bind that route.
    const pending = this.pendingChoiceRoute
    if (pending && edgeData.fromNode === pending.sourceNodeId) {
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
      return
    }

    // LLM agent change: if there's no pending choice, but the edge's fromNode is a router, make it
    // a route edge of the correct kind via the shared router-transit logic: exactly one incoming
    // choice route → inherit its color; otherwise → unbound (neutral white). A line leaving a router
    // is NEVER a plain default (grey) edge — that was the observed bug (grey, unsplittable).
    if (!pending && edgeData.fromNode) {
      const fromNode = canvas.nodes.get(edgeData.fromNode)
      const fromData = fromNode?.getData() as CanvasNodeDataWithDialogue | undefined
      // LLM agent change (#2 fix): bail on readonly — applyOutgoingRoute/saveRoute also guard, but
      // skip the pushHistory/trigger/render too so nothing runs on a locked canvas.
      if (fromData?.["x-dialogue"]?.router && fromNode && !canvas.readonly) {
        const targetRoute = this.resolveOutgoingRoute(canvas, edgeData.fromNode)
        this.applyOutgoingRoute(canvas, edge, targetRoute)
        canvas.pushHistory(canvas.getData())
        this.plugin.app.workspace.trigger("advanced-canvas:dialogue-choice-route-changed", canvas, fromNode)
        this.scheduleRenderCanvas(canvas)
      }
    }
  }

  // LLM agent change: reactive router-transit recoloring. Fired on edge-created/removed/changed.
  // We do NOT try to compute "which router was affected" from the edge's current fromNode/toNode,
  // because that misses the key case: when a dragged edge is released on a new target, the edge's
  // PREVIOUS toNode (a router that is no longer connected) doesn't appear in the event at all —
  // so its outgoing edges would stay colored per a now-stale incoming set. Instead, coalesce the
  // (frequent) edge events into a single rAF pass that recomputes EVERY router on the canvas
  // against the settled graph state. routesEqual makes the no-op case (most routers unchanged)
  // cheap, so a full sweep is fine.
  private onEdgeRouteAffected(canvas: Canvas, _edge: CanvasEdge) {
    this.scheduleRecomputeAllRouters(canvas)
  }

  // LLM agent change: coalesce many edge-changed events (which fire on every edge render during
  // pan/move/drag) into one recompute pass per frame. Mirrors scheduleRenderCanvas's pattern.
  private scheduleRecomputeAllRouters(canvas: Canvas) {
    if (this.recomputeFrames.has(canvas)) {
      return
    }
    const frameId = window.requestAnimationFrame(() => {
      this.recomputeFrames.delete(canvas)
      this.recomputeAllRouters(canvas)
    })
    this.recomputeFrames.set(canvas, frameId)
  }

  // LLM agent change: recompute the outgoing color of every router on the canvas. Each router's
  // recompute cascades downstream with a shared visited set, so a single sweep covers the whole
  // graph (the visited set prevents redundant work on shared downstream routers).
  private recomputeAllRouters(canvas: Canvas) {
    const visited = new Set<string>()
    for (const node of canvas.nodes.values()) {
      const nodeData = node.getData() as CanvasNodeDataWithDialogue
      if (nodeData["x-dialogue"]?.router) {
        this.recomputeRouterOutgoing(canvas, node, visited)
      }
    }
  }

  private renderNodeRoutes(canvas: Canvas, node: CanvasNode) {
    for (const edge of canvas.edges.values()) {
      const edgeData = edge.getData() as CanvasEdgeDataWithDialogue

      if (
        (edgeData.fromNode !== node.id && edgeData.toNode !== node.id) ||
        !this.getRoute(edgeData["x-dialogue"]?.route)
      ) {
        continue
      }

      // LLM agent change: node moves only refresh directly attached dialogue choice routes.
      this.renderRouteEdge(canvas, edge)
    }
  }

  // LLM agent change: double-clicking a route edge inserts a router node at the click point,
  // splitting the edge into source→router and router→target, both carrying the route binding.
  // All changes (remove old edge + add router node + add two new edges) go through a single
  // importData call so canvas never sees an intermediate inconsistent state.
  private onEdgeDoubleClick(canvas: Canvas, event: MouseEvent, preventDefault: { value: boolean }) {
    const target = event.target
    if (!(target instanceof HTMLElement) && !(target instanceof SVGElement)) {
      return
    }

    // Find the edge whose path element was double-clicked.
    let clickedEdge: CanvasEdge | null = null
    for (const edge of canvas.edges.values()) {
      const interactionPath = edge.path?.interaction as unknown as Element | null
      const displayPath = edge.path?.display as unknown as Element | null
      if (target === interactionPath || target === displayPath || displayPath?.contains(target as Node)) {
        clickedEdge = edge
        break
      }
    }

    if (!clickedEdge) {
      return
    }

    // LLM agent change (#2 fix): don't split edges on a readonly canvas. The split mutates the
    // canvas (removeEdge + importData + pushHistory), which a locked canvas must not allow.
    if (canvas.readonly) {
      return
    }

    const edgeData = clickedEdge.getData() as CanvasEdgeDataWithDialogue
    const route = this.getRoute(edgeData["x-dialogue"]?.route)
    if (!route || !edgeData.fromNode || !edgeData.toNode) {
      return
    }

    // This is a route edge — prevent Obsidian's default double-click (label editing).
    preventDefault.value = true

    const clickPos = canvas.posFromEvt(event)
    const routerSize = 28
    const sourceNodeId = edgeData.fromNode!
    const targetNodeId = edgeData.toNode!

    // LLM agent change: build the route payload carried by BOTH split halves — identical to the
    // original route. Choice stays choice (with refreshed choiceIndex so the color survives the
    // split); unbound/broken/unknown are carried through unchanged (no color id — renderRouteEdge
    // paints them via CSS var / dash pattern).
    let splitRoute: DialogueRouteData
    let colorId: `${number}` | undefined
    if (route.type === "choice") {
      const choiceIndex = route.choiceIndex !== undefined
        ? route.choiceIndex
        : Math.max(this.getChoiceIndex(canvas, sourceNodeId, route.choiceId!), 0)
      splitRoute = {
        type: "choice",
        choiceId: route.choiceId,
        outcome: route.outcome,
        choiceIndex,
      }
      colorId = this.getRouteCanvasColorId(choiceIndex)
    } else {
      // unbound / broken / unknown — carry through as-is, no palette color id.
      splitRoute = { type: route.type } as DialogueRouteData
      colorId = undefined
    }

    // LLM agent change: generate the router node id UPFRONT and add the node via importData (not
    // createTextNode) so the canvas never sees an intermediate inconsistent state. The prior
    // createTextNode → setData → removeEdge → importData sequence let Obsidian re-render (via
    // edge-rendered:after) between steps with an edge referencing a node whose data wasn't ready,
    // which intermittently broke canvas rendering on long edges (problem #3). Now router node + both
    // edges are built as data and applied in ONE importData call — the canvas transitions atomically
    // from one stable state to another.
    //
    // LLM agent change (#1 fix): use crypto.randomUUID() for all three ids. The old Date.now()-
    // based ids (split-router-${Date.now()}, split-${stamp}-1/-2) could COLLIDE on two splits within
    // the same millisecond — two routers would share an id and silently shadow each other. Also,
    // routerId and stamp were two separate Date.now() calls that could diverge by 1ms. UUIDs remove
    // any collision risk and keep ids globally unique with the rest of the canvas.
    const routerId = crypto.randomUUID()
    const edge1Id = crypto.randomUUID()
    const edge2Id = crypto.randomUUID()

    // LLM agent change: helper to build each split half's data. Both halves carry the SAME route as
    // the original edge; color is only set for choice routes (unbound is rendered via CSS var).
    const buildSplitEdge = (edgeId: string, fromNode: string, toNode: string): CanvasEdgeDataWithDialogue => ({
      id: edgeId,
      fromNode,
      fromSide: "right" as Side,
      toNode,
      toSide: "left" as Side,
      ...(colorId !== undefined ? { color: colorId } : {}),
      ["x-dialogue"]: {
        route: splitRoute,
      },
    })

    // Build the full import payload: router node + two edges, applied atomically.
    const importPayload = {
      nodes: [
        {
          id: routerId,
          type: "text" as const,
          text: "",
          x: clickPos.x - routerSize / 2,
          y: clickPos.y - routerSize / 2,
          width: routerSize,
          height: routerSize,
          ["x-dialogue"]: {
            router: { type: "point" },
          },
        },
      ],
      edges: [
        // edge-1: source → router
        buildSplitEdge(edge1Id, sourceNodeId, routerId),
        // edge-2: router → target
        buildSplitEdge(edge2Id, routerId, targetNodeId),
      ],
    }

    // Remove the old edge first, then import router + two edges in one atomic call.
    canvas.removeEdge(clickedEdge)
    canvas.importData(importPayload, false, false)
    canvas.pushHistory(canvas.getData())
    this.scheduleRenderCanvas(canvas)

    // LLM agent change: select the router node after the split. Root cause of "Delete doesn't work
    // after split" was DOM FOCUS THEFT — confirmed by console probes comparing the broken vs working
    // states: after a split, activeElement was `.embed-iframe.is-controlled` (Delete's keypress never
    // reached the canvas); after a real click, activeElement was the canvas wrapper (Delete worked).
    // Everything else was identical (selection.size=1, getSelectionData nodes=1, readonly=false).
    //
    // Our rAF focus() does land on the wrapper, but the freshly-imported edges / iframe content
    // render asynchronously and steal focus to `.embed-iframe.is-controlled` right after. So we
    // re-assert focus on the wrapper at several delays (rAF + 50/150/400ms) to win the race past
    // that theft. Multiple delays are kept ON PURPOSE: the theft's timing can vary between runs, the
    // extra focus() calls are effectively free, and a single missed re-assert brings the whole bug
    // back. selectOnly/setTarget alone never made Delete work — focus is the only thing that did.
    //
    // The router node is re-fetched from canvas by id (importData rebuilds node objects, so the
    // node we'd have captured pre-import may be stale).
    window.requestAnimationFrame(() => {
      const liveNode = canvas.nodes.get(routerId)
      if (!liveNode) {
        return
      }
      const focusWrapper = () => canvas.wrapperEl?.focus()
      canvas.selectOnly(liveNode)
      canvas.nodeInteractionLayer?.setTarget(liveNode)
      focusWrapper()
      window.setTimeout(focusWrapper, 50)
      window.setTimeout(focusWrapper, 150)
      window.setTimeout(focusWrapper, 400)
    })
  }

  // LLM agent change: get the index of a choice by id in the source node's choices.
  private getChoiceIndex(canvas: Canvas, sourceNodeId: string, choiceId: string): number {
    const sourceNode = canvas.nodes.get(sourceNodeId)
    if (!sourceNode) {
      return 0
    }
    const data = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choices = data["x-dialogue"]?.frame?.choices ?? []
    return choices.findIndex(choice => choice?.choiceId === choiceId)
  }

  private renderRouteEdge(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const route = this.getRoute(edgeData["x-dialogue"]?.route)

    if (!route || !edge.bezier || !edgeData.fromNode) {
      return
    }

    this.setEdgeLabelVisible(edge, false)

    const sourceNode = canvas.nodes.get(edgeData.fromNode)
    if (!sourceNode) {
      return
    }
    const sourceNodeData = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choices = sourceNodeData["x-dialogue"]?.frame?.choices ?? []

    // LLM agent change: resolve the visual color + dash for this edge by route type:
    //   choice (resolvable) → palette color, solid (failure → short-dashed)
    //   choice (unresolvable)/unbound → solid grey
    //   unknown             → grey dashed-unknown (no incoming source)
    //   broken              → red dashed-broken (choice reference lost)
    let colorCss: string
    let dashPath: string | null = null
    if (route.type === "unknown") {
      colorCss = "var(--dialogue-route-unknown-color)"
      dashPath = "dashed-unknown"
    } else if (route.type === "broken") {
      colorCss = "var(--dialogue-route-broken-color)"
      dashPath = "dashed-broken"
    } else if (route.type === "unbound") {
      colorCss = getRouteColorCss(-1, "success")
    } else {
      // choice route. Resolve the choice against the SOURCE's choices. Two cases:
      //   - fromNode is a FRAME with choices → the choiceId must resolve here; if it doesn't, the
      //     choice was deleted and this edge is BROKEN (red dashed). The cached choiceIndex must NOT
      //     mask this — it's a stale color hint for an absent choice.
      //   - fromNode is a ROUTER (no choices) → we can't validate choiceId here, so fall back to the
      //     cached choiceIndex for color. (The router's own cascade already set this edge's route
      //     type to broken/unknown/unbound if its source was invalid; a choice type here means it
      //     was deemed valid upstream.)
      const isFrameSource = choices.length > 0
      let choiceIndex = choices.findIndex(choice => choice.choiceId === route.choiceId)
      if (choiceIndex < 0 && !isFrameSource && route.choiceIndex !== undefined) {
        choiceIndex = route.choiceIndex
      }
      if (choiceIndex < 0 && isFrameSource) {
        // Choice deleted from the source frame → render as broken (red dashed), don't fall back to
        // a solid color that hides the broken reference.
        colorCss = "var(--dialogue-route-broken-color)"
        dashPath = "dashed-broken"
      } else if (choiceIndex < 0) {
        // Router source with no cached index — can't determine color, show neutral.
        colorCss = getRouteColorCss(-1, "success")
      } else {
        colorCss = getRouteColorCss(choiceIndex, route.outcome)
        if (route.outcome === "failure") {
          dashPath = "short-dashed"
        }
      }
    }

    // For router-source nodes, use the bbox center as anchor (no choice port to anchor to).
    const isRouterSource = choices.length === 0

    // LLM agent change: anchor choice — frame source anchors to the choice port, router source
    // anchors to its bbox edge center (routers have no choice ports). Non-choice routes always use
    // the bbox-center anchor (they have no choice port by definition).
    const anchor = (isRouterSource || route.type !== "choice")
      ? this.getRouterAnchor(sourceNode, edge.from.side)
      : this.getChoiceAnchor(canvas, sourceNode, route.choiceId!, route.outcome!)
    const target = this.getEdgeTargetAnchor(canvas, edge, edgeData)
    const path = this.buildBezierPath(anchor, target, edge.from.side, edge.to.side)

    edge.center = {
      x: (anchor.x + target.x) / 2,
      y: (anchor.y + target.y) / 2,
    }
    edge.path.interaction.setAttr("d", path)
    edge.path.display.setAttr("d", path)

    // LLM agent change: apply the dash pattern (short-dashed / dashed-unknown / dashed-broken / none).
    if (dashPath) {
      edge.path.display.setAttr("data-path", dashPath)
      edge.path.interaction.setAttr("data-path", dashPath)
    } else {
      edge.path.display.removeAttribute("data-path")
      edge.path.interaction.removeAttribute("data-path")
    }

    this.applyEdgeColor(edge, colorCss)
    // LLM agent change: do not re-render the native label from our route renderer; it can recursively trigger edge renders.
    this.setEdgeLabelVisible(edge, false)
  }

  // LLM agent change: resolve the route that a router's OUTGOING edge should carry, based on the
  // router's incoming route edges. Classifies each incoming edge, then applies the rules:
  //   - 0 incoming route edges, OR only UNKNOWN incoming        → UNKNOWN  (no source — grey dashed)
  //   - ALL incoming edges are BROKEN (choice deleted)          → BROKEN   (red dashed)
  //   - has non-broken, non-unknown edges (those ignored):
  //       exactly 1 valid CHOICE                                → CHOICE   (inherit its color)
  //       else (multiple choices / unbound present)             → UNBOUND  (solid grey)
  //
  // "unknown" propagates: an incoming unknown edge means "no source upstream", which is the same
  // as having no incoming at all — so a router fed only by unknown edges emits unknown downstream.
  // (Contrast with unbound: an incoming unbound means "valid but ambiguous", which makes the
  // outgoing unbound solid-grey.)
  //
  // "Broken" classification of an incoming edge:
  //   - type "broken" already                                  → broken
  //   - type "choice" AND its fromNode is a frame AND its choiceId is NOT in that frame's choices
  //                                                              → broken (live validity check)
  //   - type "choice" from a router (no choices to check)       → trusted as valid (the upstream
  //     router's own cascade already re-typed it broken/unknown if its source was invalid)
  private resolveOutgoingRoute(canvas: Canvas, routerId: string): DialogueRouteData {
    let hasAny = false
    let onlyUnknown = true
    let allBroken = true
    let validChoiceCount = 0
    let lastValidChoice: DialogueChoiceRouteData | null = null

    for (const edge of canvas.edges.values()) {
      const data = edge.getData() as CanvasEdgeDataWithDialogue
      if (data.toNode !== routerId) {
        continue
      }
      const route = this.getRoute(data["x-dialogue"]?.route)
      if (!route) {
        continue
      }
      hasAny = true

      // Classify this incoming edge.
      if (route.type === "broken") {
        // already broken — counts toward allBroken but is otherwise ignored. Doesn't clear
        // onlyUnknown (a mix of broken + unknown still has no valid source).
        continue
      }
      if (route.type === "unknown") {
        // unknown = no source upstream. Doesn't provide a color, doesn't count as broken, but also
        // doesn't clear onlyUnknown — see the comment above about unknown propagation.
        allBroken = false
        continue
      }
      if (route.type === "choice") {
        // Live validity check: if the edge's fromNode is a frame and the choiceId isn't in its
        // choices, this reference is broken.
        if (data.fromNode) {
          const fromNode = canvas.nodes.get(data.fromNode)
          const fromData = fromNode?.getData() as CanvasNodeDataWithDialogue | undefined
          const choices = fromData?.["x-dialogue"]?.frame?.choices
          if (choices && !choices.some(choice => choice.choiceId === route.choiceId)) {
            // fromNode is a frame but choiceId is gone → broken
            continue
          }
        }
        // valid choice
        allBroken = false
        onlyUnknown = false
        validChoiceCount++
        lastValidChoice = route
        continue
      }
      // type unbound — valid but carries no choice color. This is a real (if ambiguous) source,
      // so it clears onlyUnknown: the outgoing becomes unbound, not unknown.
      allBroken = false
      onlyUnknown = false
    }

    if (!hasAny || onlyUnknown) {
      // No incoming routes at all, OR every incoming was unknown (no source upstream) → the
      // outgoing has no source either → unknown (grey dashed). This is the propagation fix: a
      // chain of routers fed only by unknown stays unknown to the end, instead of flipping to
      // solid unbound.
      return { type: "unknown" }
    }
    if (allBroken) {
      return { type: "broken" }
    }
    if (validChoiceCount === 1 && lastValidChoice) {
      return { ...lastValidChoice }
    }
    return { type: "unbound" }
  }

  // LLM agent change: set an outgoing edge's route to the resolved value WITHOUT pushing history or
  // triggering the choice-route-changed event (the cascade caller does that once at the end, so we
  // get a single history entry for a whole cascade, not one per edge). Returns true if the edge
  // actually changed (so the caller knows whether to continue the cascade downstream).
  private applyOutgoingRoute(canvas: Canvas, edge: CanvasEdge, route: DialogueRouteData): boolean {
    // LLM agent change (#2 fix): the reactive cascade (edge-changed → recomputeAllRouters) reaches
    // here even on a readonly canvas (edge-changed fires during view/selection). Bail before any
    // setData, otherwise a readonly canvas gets mutated and requestSave'd.
    if (canvas.readonly) {
      return false
    }
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const existing = this.getRoute(edgeData["x-dialogue"]?.route)

    // LLM agent change (#5/#7 fix): normalize the route BEFORE persisting. Two problems this solves:
    //  #5 (stale choiceId) — if the route's choice can't be resolved against the source frame's
    //    choices (frame deleted, choice removed, or a choice route inherited through a router whose
    //    fromNode isn't the original frame), the persisted data carried a choiceId pointing at a
    //    non-existent choice. Now we degrade to unbound IN THE DATA, not just in the render color.
    //  #7 (missing choiceIndex) — choiceIndex was computed locally for the color but never written
    //    into the route object, so the persisted route lacked it and would desync on choice reordering.
    //    Now we persist the resolved choiceIndex on the route object itself.
    let normalizedRoute: DialogueRouteData = route
    let choiceIndex = -1 // -1 = unbound (neutral color)
    let isFailure = false
    if (route.type === "choice") {
      const sourceNode = edgeData.fromNode ? canvas.nodes.get(edgeData.fromNode) : undefined
      const sourceNodeData = sourceNode?.getData() as CanvasNodeDataWithDialogue | undefined
      const choices = sourceNodeData?.["x-dialogue"]?.frame?.choices ?? []
      choiceIndex = choices.findIndex(choice => choice.choiceId === route.choiceId)
      if (choiceIndex < 0 && route.choiceIndex !== undefined) {
        choiceIndex = route.choiceIndex
      }
      if (choiceIndex < 0) {
        // Unresolved choice → degrade to unbound in the DATA too, not just render color. Prevents a
        // stale choiceId from persisting on the edge.
        normalizedRoute = { type: "unbound" }
        choiceIndex = -1
      } else {
        // Persist the resolved choiceIndex so color survives choice reordering downstream.
        normalizedRoute = { ...route, choiceIndex }
        isFailure = route.outcome === "failure"
      }
    }

    // Skip if already correct — prevents infinite cascade loops (setData → edge-changed → recompute).
    // Uses the NORMALIZED route, so an edge already storing the degraded unbound won't re-write.
    if (existing && this.routesEqual(existing, normalizedRoute)) {
      return false
    }

    const nextXDialogue: DialogueEdgeData = {
      ...edgeData["x-dialogue"],
      route: normalizedRoute,
    }
    delete nextXDialogue.answer

    const nextEdgeData: CanvasEdgeDataWithDialogue = {
      ...edgeData,
      label: "",
      styleAttributes: {
        ...edgeData.styleAttributes,
        path: isFailure ? "short-dashed" : null,
      },
      "x-dialogue": nextXDialogue,
    }

    edge.setData(nextEdgeData)
    return true
  }

  // LLM agent change: structural equality for routes — used by applyOutgoingRoute to skip no-op
  // updates (which would otherwise loop the cascade: setData → edge-changed → recompute → setData).
  // For non-choice types (unbound/broken/unknown) equality is just "same type" — they carry no
  // other fields. Choice routes additionally compare choiceId + outcome (NOT choiceIndex — it's a
  // cached color value, intentionally excluded so it can be normalized without looping).
  private routesEqual(a: DialogueRouteData, b: DialogueRouteData): boolean {
    if (a.type !== b.type) {
      return false
    }
    if (a.type === "choice" && b.type === "choice") {
      return a.choiceId === b.choiceId && a.outcome === b.outcome
    }
    // both unbound / broken / unknown — same type is enough
    return true
  }

  // LLM agent change: recompute the outgoing route color of every edge leaving a router, based on
  // the router's current incoming routes, then cascade downstream: if an outgoing edge's target is
  // itself a router, its outgoing color may have changed too. `visited` guards against cycles in
  // the router graph. Recomputes only router nodes — frames/regular nodes are unaffected.
  private recomputeRouterOutgoing(canvas: Canvas, routerNode: CanvasNode, visited: Set<string>) {
    const routerId = routerNode.getData().id
    if (visited.has(routerId)) {
      return
    }
    visited.add(routerId)

    const targetRoute = this.resolveOutgoingRoute(canvas, routerId)
    let anyChanged = false

    for (const edge of canvas.edges.values()) {
      const data = edge.getData() as CanvasEdgeDataWithDialogue
      if (data.fromNode !== routerId) {
        continue
      }
      if (this.applyOutgoingRoute(canvas, edge, targetRoute)) {
        anyChanged = true
        // Cascade: if this edge leads to another router, that router's incoming set changed.
        const downstreamId = data.toNode
        if (downstreamId) {
          const downstream = canvas.nodes.get(downstreamId)
          const downstreamData = downstream?.getData() as CanvasNodeDataWithDialogue | undefined
          if (downstream && downstreamData?.["x-dialogue"]?.router) {
            this.recomputeRouterOutgoing(canvas, downstream, visited)
          }
        }
      }
    }

    if (anyChanged) {
      this.scheduleRenderCanvas(canvas)
    }
  }

  // LLM agent change: anchor for a router node — center of the given side of its bbox.
  private getRouterAnchor(routerNode: CanvasNode, side: string): Position {
    const bbox = routerNode.getBBox()
    if (side === "left") return { x: bbox.minX, y: (bbox.minY + bbox.maxY) / 2 }
    if (side === "right") return { x: bbox.maxX, y: (bbox.minY + bbox.maxY) / 2 }
    if (side === "top") return { x: (bbox.minX + bbox.maxX) / 2, y: bbox.minY }
    if (side === "bottom") return { x: (bbox.minX + bbox.maxX) / 2, y: bbox.maxY }
    return { x: bbox.maxX, y: (bbox.minY + bbox.maxY) / 2 }
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
    const resolvedColor = resolveCssColor(cssColor)

    edge.lineGroupEl?.style.setProperty("--canvas-color", resolvedColor)
    edge.lineEndGroupEl?.style.setProperty("--canvas-color", resolvedColor)
    edge.path.display?.setAttr("stroke", resolvedColor)
    edge.path.display?.style.setProperty("stroke", resolvedColor)
    edge.path.interaction?.removeAttribute("stroke")
    edge.path.interaction?.style.removeProperty("stroke")
    edge.fromLineEnd?.el?.querySelector("polygon")?.setAttribute("style", `fill: ${resolvedColor}; stroke: ${resolvedColor};`)
    edge.toLineEnd?.el?.querySelector("polygon")?.setAttribute("style", `fill: ${resolvedColor}; stroke: ${resolvedColor};`)
  }

  private getRouteCanvasColorId(choiceIndex: number): `${number}` {
    // LLM agent change: return a template-literal-number type (e.g. "1".."8") so the value
    // satisfies the project's narrow `CanvasColor = \`${number}\` | \`#${string}\`` union
    // without an `as` cast. Obsidian's stored canvas colors are 1-based palette indices.
    return String(choiceIndex % 8 + 1) as `${number}`
  }

  // LLM agent change: getRouteColorCss and resolveCssColor moved to src/utils/dialogue-route-color.ts
  // so the router extension can share the exact same color logic (node color must match edge color).

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

  // LLM agent change: any route (choice, unbound, broken, OR unknown). Returns the route object if
  // this edge is a route edge of any kind — used to decide "is this a route line at all" regardless
  // of choice binding. Broken/unknown routes are routes too (valid edge slots awaiting a valid
  // source/binding) — they just render differently.
  private getRoute(route: DialogueFailureRouteData | undefined): DialogueRouteData | undefined {
    if (route?.type === "unbound" || route?.type === "broken" || route?.type === "unknown") {
      return route as DialogueUnboundRouteData | DialogueBrokenRouteData | DialogueUnknownRouteData
    }
    return this.getChoiceRoute(route)
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
