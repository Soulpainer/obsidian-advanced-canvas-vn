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

  // LLM agent change: route edges bind to numbered choices stored inside frame nodes.
  isEnabled() {
    return true
  }

  init() {
    // LLM agent change: initialize Map fields first, before any event handler can fire
    // (see the field declaration comment above for why this ordering matters).
    this.renderFrames = new WeakMap<Canvas, number>()
    this.activePointerRenderStops = new WeakMap<Canvas, () => void>()

    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:popup-menu-created",
      (canvas: Canvas) => this.onPopupMenuCreated(canvas)
    ))

    const rerender = (canvas: Canvas) => this.scheduleRenderCanvas(canvas)
    // LLM agent change: native edges re-render very frequently (on hover, focus, drag, viewport
    // changes), and 'edge-rendered:after' fires for each. Calling renderRouteEdge synchronously
    // on every fire forced a getBoundingClientRect read each time -> layout thrashing -> visible
    // lag whenever the cursor sat over an edge. Coalesce into the rAF-scheduled full-canvas render
    // (scheduleRenderCanvas dedupes to one frame per canvas), so many edge-render events in a
    // single frame collapse into a single route re-render.
    //
    // Additional guard: route paths are authored in canvas (world) coordinates and do NOT change
    // when only the viewport moves (pan/zoom). The hovered edge re-renders constantly while
    // panning with the cursor over it, which would otherwise re-run getBoundingClientRect every
    // frame. Skip the re-render entirely while the viewport is changing — the native edge path
    // keeps following the pan, and our path stays correct in world space.
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:edge-rendered:after",
      (canvas: Canvas) => {
        if (canvas.viewportChanged || canvas.isDragging) {
          return
        }
        this.scheduleRenderCanvas(canvas)
      }
    ))
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:dialogue-frame-rendered",
      (canvas: Canvas, node: CanvasNode) => this.renderSourceNodeRoutes(canvas, node)
    ))
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
    const nodeEl = this.getNodeElement(sourceNode)
    const portSelector = `.dialogue-canvas-choice-route-port[data-dialogue-choice-id="${this.escapeCss(choiceId)}"][data-dialogue-choice-outcome="${outcome}"]`
    const rowSelector = outcome === "failure"
      ? `.dialogue-canvas-choice-failure[data-dialogue-choice-id="${this.escapeCss(choiceId)}"]`
      : `.dialogue-canvas-choice-row[data-dialogue-choice-id="${this.escapeCss(choiceId)}"]`
    const portEl = nodeEl?.querySelector(portSelector) as HTMLElement | null
    const anchorEl = nodeEl?.querySelector(rowSelector) as HTMLElement | null
    const fallbackEl = nodeEl?.querySelector(
      `.dialogue-canvas-choice-row[data-dialogue-choice-id="${this.escapeCss(choiceId)}"]`
    ) as HTMLElement | null
    const targetEl = portEl ?? anchorEl ?? fallbackEl

    // LLM agent change: only trust the DOM rect when it is genuinely usable. Obsidian lazily
    // renders / clips node content that scrolls outside the viewport, so getBoundingClientRect()
    // can return zero-size or stale boxes — which made choice edges "drift" when the source node
    // touched or crossed the canvas edge. When the rect is invalid, fall back to a geometric
    // anchor computed from the node bbox and the choice-list layout (see getChoiceAnchorGeometric).
    if (targetEl && this.isDomAnchorUsable(canvas, sourceNode, targetEl)) {
      const rect = targetEl.getBoundingClientRect()
      const viewportAnchor = canvas.posFromClient({
        x: portEl ? rect.left + rect.width / 2 : rect.right,
        y: rect.top + rect.height / 2,
      })

      return viewportAnchor
    }

    const sourceNodeData = sourceNode.getData() as CanvasNodeDataWithDialogue
    const choices = sourceNodeData["x-dialogue"]?.frame?.choices ?? []
    return this.getChoiceAnchorGeometric(sourceNode, choices, choiceId, outcome)
  }

  // LLM agent change: heuristic deciding whether a DOM anchor's bounding rect is trustworthy.
  // Returns false when the rect is zero-size or when the source node is outside the current
  // viewport (Obsidian may have un-rendered or clipped its inner DOM in that case).
  private isDomAnchorUsable(canvas: Canvas, sourceNode: CanvasNode, targetEl: HTMLElement): boolean {
    const rect = targetEl.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return false
    }

    const viewport = canvas.getViewportBBox()
    const nodeBbox = sourceNode.getBBox()
    // Allow partial overlap; only distrust when the node is entirely off-screen.
    const horizontallyOff = nodeBbox.maxX < viewport.minX || nodeBbox.minX > viewport.maxX
    const verticallyOff = nodeBbox.maxY < viewport.minY || nodeBbox.minY > viewport.maxY
    return !(horizontallyOff || verticallyOff)
  }

  // LLM agent change: geometric fallback for getChoiceAnchor. Mirrors the choice-list layout
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
