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
  DialogueFrameEditorValue,
  DialogueNodeData,
} from "src/@types/DialogueCanvas"
import CanvasHelper from "src/utils/canvas-helper"
import DialogueCharactersLoader from "src/utils/dialogue-characters-loader"
import DialoguePropertiesLoader from "src/utils/dialogue-properties-loader"
import DialogueStatsLoader from "src/utils/dialogue-stats-loader"
import CanvasExtension from "./canvas-extension"
import EditDialogueFrameModal from "src/modals/edit-dialogue-frame-modal"

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
  private readonly choiceRowHeight = 30
  private readonly choiceFailureRowHeight = 24
  private readonly choicesBottomPadding = 12

  // LLM agent change: route edges bind to numbered choices stored inside frame nodes.
  isEnabled() {
    return true
  }

  init() {
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:popup-menu-created",
      (canvas: Canvas) => this.onPopupMenuCreated(canvas)
    ))

    const rerender = (canvas: Canvas) => this.scheduleRenderCanvas(canvas)
    this.plugin.registerEvent(this.plugin.app.workspace.on("advanced-canvas:edge-changed", rerender))
    this.plugin.registerEvent(this.plugin.app.workspace.on("advanced-canvas:node-changed", rerender))
    this.plugin.registerEvent(this.plugin.app.workspace.on("advanced-canvas:node-moved", rerender))
    this.plugin.registerEvent(this.plugin.app.workspace.on("advanced-canvas:node-resized", rerender))
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:edge-connection-dragging:before",
      (canvas: Canvas) => this.renderWhilePointerMoves(canvas)
    ))
    this.plugin.registerEvent(this.plugin.app.workspace.on("layout-change", () => this.scheduleRenderAllCanvases()))
    this.plugin.registerEvent(this.plugin.app.workspace.on("active-leaf-change", () => this.scheduleRenderAllCanvases()))

    this.scheduleRenderAllCanvases()
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

    edge.setData({
      ...edgeData,
      color: this.getRouteColorId(Math.max(choiceIndex, 0), route.outcome),
      label: "",
      styleAttributes: {
        ...edgeData.styleAttributes,
        path: route.outcome === "failure" ? "short-dashed" : null,
      },
      "x-dialogue": nextXDialogue,
    })
    canvas.pushHistory(canvas.getData())
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
      color: this.getRouteColorId(choiceIndex, route.outcome),
      label: "",
      styleAttributes: {
        path: route.outcome === "failure" ? "short-dashed" : null,
      },
      "x-dialogue": {
        route,
      },
    }

    node.setData({
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
    })
    canvas.importData({ nodes: [], edges: [edgeData] }, false, false)
    canvas.selectOnly(node)
    canvas.pushHistory(canvas.getData())
    this.scheduleRenderCanvas(canvas)

    await this.openFrameModal(canvas, node)
  }

  private async openFrameModal(canvas: Canvas, node: CanvasNode) {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const frameMeta = nodeData["x-dialogue"]?.frame
    const [characters, stats, properties] = await Promise.all([
      DialogueCharactersLoader.loadCharacters(this.plugin.app as any),
      DialogueStatsLoader.loadStats(this.plugin.app as any),
      DialoguePropertiesLoader.loadProperties(this.plugin.app as any),
    ])
    const initialValue: DialogueFrameEditorValue = {
      frameId: frameMeta?.frameId ?? this.generateFrameId(nodeData.text ?? nodeData.id),
      speakerId: frameMeta?.speakerId,
      text: nodeData.text ?? "",
      choices: frameMeta?.choices?.map(choice => ({ ...choice })) ?? [],
    }

    new EditDialogueFrameModal(this.plugin.app as any, {
      initialValue,
      characters,
      stats,
      properties,
      onSubmit: value => this.saveFrame(canvas, node, value),
    }).open()
  }

  private saveFrame(canvas: Canvas, node: CanvasNode, value: DialogueFrameEditorValue) {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const existingFrame = nodeData["x-dialogue"]?.frame

    node.setData({
      ...nodeData,
      text: value.text,
      height: Math.max(nodeData.height ?? 0, this.getMinimumNodeHeightForChoices(value.choices ?? []), 160),
      "x-dialogue": {
        ...nodeData["x-dialogue"],
        frame: {
          frameId: value.frameId,
          speakerId: value.speakerId,
          choices: value.choices ?? [],
          checks: existingFrame?.checks,
          conditions: existingFrame?.conditions,
        },
      },
    })
    canvas.pushHistory(canvas.getData())
    this.scheduleRenderCanvas(canvas)
  }

  private scheduleRenderAllCanvases() {
    window.setTimeout(() => {
      for (const canvas of this.plugin.getCanvases?.() ?? []) {
        this.renderCanvas(canvas)
      }
    }, 120)
  }

  private scheduleRenderCanvas(canvas: Canvas) {
    window.setTimeout(() => this.renderCanvas(canvas), 120)
  }

  // LLM agent change: route anchors follow the pointer while a canvas edge connection is being dragged.
  private renderWhilePointerMoves(canvas: Canvas) {
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

      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }

      this.renderCanvas(canvas)
    }

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
    const path = this.buildBezierPath(anchor, edge.bezier.to, edge.from.side, edge.to.side)

    edge.center = {
      x: (anchor.x + edge.bezier.to.x) / 2,
      y: (anchor.y + edge.bezier.to.y) / 2,
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

    this.applyEdgeColor(edge, this.getRouteColorId(choiceIndex, route.outcome))
    edge.labelElement?.render()
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

    if (targetEl) {
      const rect = targetEl.getBoundingClientRect()
      return canvas.posFromClient({
        x: portEl ? rect.left + rect.width / 2 : rect.right,
        y: rect.top + rect.height / 2,
      })
    }

    const bbox = sourceNode.getBBox()
    return {
      x: bbox.maxX,
      y: (bbox.minY + bbox.maxY) / 2,
    }
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

  private applyEdgeColor(edge: CanvasEdge, colorId: string) {
    const colorValue = `var(--canvas-color-${colorId})`
    const cssColor = `rgb(${colorValue})`

    edge.lineGroupEl?.style.setProperty("--canvas-color", colorValue)
    edge.lineEndGroupEl?.style.setProperty("--canvas-color", colorValue)
    edge.path.display?.style.setProperty("stroke", cssColor)
    edge.fromLineEnd?.el?.querySelector("polygon")?.setAttribute("style", `fill: ${cssColor}; stroke: ${cssColor};`)
    edge.toLineEnd?.el?.querySelector("polygon")?.setAttribute("style", `fill: ${cssColor}; stroke: ${cssColor};`)
  }

  private getRouteColorId(choiceIndex: number, outcome: DialogueChoiceRouteOutcome): string {
    const base = choiceIndex * 2
    return String((outcome === "success" ? base : base + 1) % 6 + 1)
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
