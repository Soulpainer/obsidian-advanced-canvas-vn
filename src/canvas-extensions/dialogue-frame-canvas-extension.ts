import { Notice, TFile } from "obsidian"
import { Canvas, CanvasElement, CanvasNode } from "src/@types/Canvas"
import {
  DialogueCharacterDefinition,
  DialogueChoiceData,
  DialogueChoiceRouteOutcome,
  DialogueFrameEditorValue,
  DialogueFailureRouteData,
  DialogueNodeData,
  DialogueStatDefinition,
} from "src/@types/DialogueCanvas"
import CanvasHelper from "src/utils/canvas-helper"
import CanvasExtension from "./canvas-extension"
import DialogueCharactersLoader from "src/utils/dialogue-characters-loader"
import DialoguePropertiesLoader from "src/utils/dialogue-properties-loader"
import DialogueStatsLoader from "src/utils/dialogue-stats-loader"
import DialogueTriggersLoader from "src/utils/dialogue-triggers-loader"
import EditDialogueFrameModal, { DialogueFrameFocusTarget } from "src/modals/edit-dialogue-frame-modal"

type CanvasNodeDataWithDialogue = ReturnType<CanvasNode["getData"]> & {
  id: string
  type?: string
  text?: string
  width?: number
  height?: number
  color?: string
  ["x-dialogue"]?: DialogueNodeData
}

type CanvasEdgeDataWithDialogue = {
  fromNode?: string
  ["x-dialogue"]?: {
    route?: DialogueFailureRouteData
  }
}

export default class DialogueFrameCanvasExtension extends CanvasExtension {
  private renderQueued = false
  // LLM agent change: Map/Set fields declared without initializers and created at the top of
  // init(). The base CanvasExtension constructor calls init() from within super(), which runs
  // BEFORE TypeScript field initializers (those execute after super() returns), so initializing
  // these inline left them undefined when init() ran scheduleRenderAllCanvases(). See
  // DialogueChoiceRouteCanvasExtension for the same fix and fuller explanation.
  private renderFrames!: WeakMap<Canvas, number>
  private editModalOpenNodes!: WeakSet<CanvasNode>
  // LLM agent change: freshly-spawned frame nodes (via drag-to-spawn) whose editor is open,
  // mapped to the edge that connects them to the source. If the user cancels the editor, both the
  // node and the edge are removed so the canvas returns to its pre-spawn state.
  private spawnedFrameNodes!: Map<CanvasNode, string>

  // Минимальная высота карточки, если у неё есть speaker.
  // Подгони под свой шаг сетки.
  private readonly minSpeakerNodeHeight = 160
  private readonly minFrameContentHeight = 120
  private readonly choicesTopGap = 12
  // LLM agent change: real measured choice-row geometry (kept in sync with
  // DialogueChoiceRouteCanvasExtension). A row without failure is 22px; a failure sub-block adds
  // 30px. Used to compute the choice-list / node height. See the route extension for the matching
  // port-center constants.
  private readonly choiceRowHeight = 22
  private readonly choiceFailureRowHeight = 30
  private readonly choicesBottomPadding = 12
  private readonly minDialogueNodeWidth = 280

  private observedCanvasWrappers!: WeakSet<HTMLElement>

  isEnabled() {
    return true
  }

  init() {
    // LLM agent change: initialize Map/Set fields first, before any event handler can fire
    // (see the field declarations above for why this ordering matters).
    this.renderFrames = new WeakMap<Canvas, number>()
    this.editModalOpenNodes = new WeakSet<CanvasNode>()
    this.spawnedFrameNodes = new Map<CanvasNode, string>()
    this.observedCanvasWrappers = new WeakSet<HTMLElement>()

    console.log("[Dialogue Canvas] DialogueFrameCanvasExtension init")

    this.plugin.registerEvent(
      this.plugin.app.workspace.on(
        "advanced-canvas:popup-menu-created",
        (canvas: Canvas) => this.onPopupMenuCreated(canvas)
      )
    )

    this.plugin.registerEvent(
      this.plugin.app.workspace.on("layout-change", () => {
        this.scheduleRenderAllCanvases()
      })
    )

    this.plugin.registerEvent(
      this.plugin.app.workspace.on("advanced-canvas:node-resized", (canvas: Canvas, node: CanvasNode) => {
        this.enforceDialogueNodeMinSize(canvas, node)
      })
    )

    this.plugin.registerEvent(
      this.plugin.app.workspace.on("advanced-canvas:double-click", (canvas: Canvas, event: MouseEvent, preventDefault) => {
        this.openDialogueFrameFromDoubleClick(canvas, event, preventDefault)
      })
    )

    this.plugin.registerEvent(
      this.plugin.app.workspace.on("advanced-canvas:dialogue-frame-edit-requested", (canvas: Canvas, node: CanvasNode) => {
        this.openDialogueFrameFromNativeEditRequest(canvas, node)
      })
    )

    this.plugin.registerEvent(
      this.plugin.app.workspace.on("active-leaf-change", () => {
        this.scheduleRenderAllCanvases()
      })
    )

    const rerenderCanvas = (canvas: Canvas) => this.scheduleRenderCanvas(canvas)
    this.plugin.registerEvent(this.plugin.app.workspace.on("advanced-canvas:edge-created", rerenderCanvas))
    this.plugin.registerEvent(this.plugin.app.workspace.on("advanced-canvas:edge-removed", rerenderCanvas))
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:dialogue-choice-route-changed",
      (canvas: Canvas) => this.scheduleRenderCanvas(canvas)
    ))
    // LLM agent change: track freshly-spawned frame nodes so we can remove them (and their edge)
    // if the user cancels the frame editor.
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:dialogue-node-spawned",
      (canvas: Canvas, nodeId: string, edgeId: string) => {
        const node = canvas.nodes.get(nodeId)
        if (node) {
          this.spawnedFrameNodes.set(node, edgeId)
        }
      }
    ))
    // LLM agent change: when a spawn is cancelled from the choice-route modal, remove the node + edge.
    this.plugin.registerEvent(this.plugin.app.workspace.on(
      "advanced-canvas:dialogue-spawn-cancel",
      (_canvas: Canvas, edgeId: string) => {
        this.removeSpawnedNode(edgeId)
      }
    ))

    this.scheduleRenderAllCanvases()
  }

  private onPopupMenuCreated(canvas: Canvas) {
    const selectedNodes = this.getSelectedNodes(canvas)

    if (canvas.readonly || selectedNodes.length !== 1) {
      return
    }

    const nodeData = selectedNodes[0]!.getData() as CanvasNodeDataWithDialogue

    const isEndNode = canvas.metadata["endNode"] === nodeData.id
    CanvasHelper.addPopupMenuOption(
      canvas,
      CanvasHelper.createPopupMenuOption({
        id: "dialogue-canvas-set-end-frame",
        icon: "badge-check",
        label: isEndNode ? "Unset Dialogue End" : "Set Dialogue End",
        callback: () => this.toggleDialogueEndNode(canvas, selectedNodes[0]!),
      })
    )

    if (!nodeData.type || nodeData.type === "text") {
      CanvasHelper.addPopupMenuOption(
        canvas,
        CanvasHelper.createPopupMenuOption({
          id: "dialogue-canvas-set-start-frame",
          icon: "play",
          label: "Set Dialogue Start",
          callback: () => this.setDialogueStartNode(canvas, selectedNodes[0]!),
        })
      )
    }
  }

  private getSelectedNodes(canvas: Canvas): CanvasNode[] {
    return [...canvas.selection].filter((item: CanvasElement) => {
      const maybeEdge = item as any
      const maybeNode = item as any

      if (maybeEdge.path !== undefined) {
        return false
      }

      if (typeof maybeNode.getData !== "function") {
        return false
      }

      const data = maybeNode.getData()

      return data && data.id && data.fromNode === undefined && data.toNode === undefined
    }) as CanvasNode[]
  }

  private async openEditFrameModal(canvas: Canvas, node: CanvasNode, focusTarget?: DialogueFrameFocusTarget) {
    if (this.editModalOpenNodes.has(node)) {
      return
    }

    this.editModalOpenNodes.add(node)
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const frameMeta = nodeData["x-dialogue"]?.frame
    const [characters, stats, properties, triggers] = await Promise.all([
      DialogueCharactersLoader.loadCharacters(this.plugin.app as any),
      DialogueStatsLoader.loadStats(this.plugin.app as any),
      DialoguePropertiesLoader.loadProperties(this.plugin.app as any),
      DialogueTriggersLoader.loadTriggers(this.plugin.app as any),
    ])

    const initialValue: DialogueFrameEditorValue = {
      frameId:
        frameMeta?.frameId ??
        this.generateFrameId(nodeData.text ?? nodeData.id),

      speakerId:
        frameMeta?.speakerId,

      // Текст фрейма живёт только в node.text.
      // x-dialogue.frame.text больше не читаем.
      text:
        nodeData.text ?? "",

      choices:
        frameMeta?.choices?.map(choice => ({ ...choice })),
      actions:
        frameMeta?.actions?.map(action => ({ ...action })),
    }

    new EditDialogueFrameModal(this.plugin.app as any, {
      initialValue,
      characters,
      stats,
      properties,
      triggers,
      focusTarget,
      onSubmit: value => {
        this.saveDialogueFrame(canvas, node, value)
      },
      onClose: (wasSubmitted: boolean) => {
        this.editModalOpenNodes.delete(node)

        // LLM agent change: if this was a freshly-spawned node and the user cancelled (didn't
        // save), remove the node and its connecting edge so the canvas returns to its pre-spawn
        // state. Only act for nodes we tracked as spawned — existing nodes are left alone.
        const spawnedEdgeId = this.spawnedFrameNodes.get(node)
        if (spawnedEdgeId !== undefined && !wasSubmitted) {
          this.removeSpawnedNode(spawnedEdgeId)
        }
        this.spawnedFrameNodes.delete(node)
      },
    }).open()
  }

  // LLM agent change: remove a freshly-spawned node and its connecting edge (clean up after a
  // cancelled spawn). Called from the frame editor onClose and from the dialogue-spawn-cancel
  // event (choice-route modal cancel). Safe to call once — removes the edge, then the node it
  // points at.
  private removeSpawnedNode(edgeId: string) {
    const canvas = this.plugin.getCurrentCanvas()
    if (!canvas) {
      return
    }
    const edge = canvas.edges.get(edgeId)
    if (edge) {
      // Find the spawned node (the edge's target) before removing the edge.
      const edgeData = edge.getData()
      const targetId = (edgeData as { toNode?: string }).toNode
      const targetNode = targetId ? canvas.nodes.get(targetId) : undefined

      canvas.removeEdge(edge)
      // Only remove the node if we're tracking it as spawned (defensive — never touch unrelated nodes).
      if (targetNode && this.spawnedFrameNodes.has(targetNode)) {
        canvas.removeNode(targetNode)
        this.spawnedFrameNodes.delete(targetNode)
      }
      canvas.pushHistory(canvas.getData())
    }
  }

  private openDialogueFrameFromNativeEditRequest(canvas: Canvas, node: CanvasNode) {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue

    if (!nodeData["x-dialogue"]?.frame) {
      return
    }

    this.exitInlineEditing(node)
    // LLM agent change: native canvas edit button opens the dialogue frame modal instead of inline editing.
    void this.openEditFrameModal(canvas, node, { type: "frameText" })
  }

  private saveDialogueFrame(
    canvas: Canvas,
    node: CanvasNode,
    editorValue: DialogueFrameEditorValue
  ) {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const adjustedData = this.applySpeakerMinHeight(nodeData, editorValue)

    const nextData: CanvasNodeDataWithDialogue = {
      ...nodeData,
      ...adjustedData,

      // Единственное место хранения текста реплики.
      text: editorValue.text,

      // Только metadata. Текста здесь быть не должно.
      "x-dialogue": {
        ...nodeData["x-dialogue"],
        frame: {
          frameId: editorValue.frameId,
          speakerId: editorValue.speakerId,
          choices: editorValue.choices ?? [],
          actions: editorValue.actions ?? [],
          // LLM agent change: removed legacy `checks`/`conditions` — they are not part of
          // DialogueFrameData (checks/conditions live on choices, not on the frame itself).
        },
      },
    }

    node.setData(nextData)
    canvas.pushHistory(canvas.getData())

    new Notice("Dialogue Canvas: Frame saved")
    console.log("[Dialogue Canvas] Saved frame data", nextData)

    this.scheduleRenderCanvas(canvas)
  }

  // LLM agent change: dialogue start uses canvas metadata, independent from player/NPC runtime control.
  private setDialogueStartNode(canvas: Canvas, node: CanvasNode) {
    canvas.metadata["startNode"] = node.getData().id
    canvas.requestSave()
    this.scheduleRenderCanvas(canvas)
    new Notice("Dialogue canvas: start node set")
  }

  // LLM agent change: dialogue endings are canvas-level terminal frame markers, parallel to the start marker.
  private toggleDialogueEndNode(canvas: Canvas, node: CanvasNode) {
    const nodeId = node.getData().id

    if (canvas.metadata["endNode"] === nodeId) {
      delete canvas.metadata["endNode"]
      new Notice("Dialogue canvas: end node unset")
    } else {
      canvas.metadata["endNode"] = nodeId
      new Notice("Dialogue canvas: end node set")
    }

    canvas.requestSave()
    this.scheduleRenderCanvas(canvas)
  }

  // LLM agent change: users can resize canvas nodes manually, so dialogue frames clamp back to embedded content size.
  private enforceDialogueNodeMinSize(canvas: Canvas, node: CanvasNode) {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const frame = nodeData["x-dialogue"]?.frame

    if (!frame) {
      return
    }

    const minHeight = Math.max(
      this.minSpeakerNodeHeight,
      this.getMinimumNodeHeightForChoices(frame.choices ?? [])
    )
    const minWidth = (frame.choices?.length ?? 0) > 0 || Boolean(frame)
      ? this.minDialogueNodeWidth
      : 0
    const nextHeight = typeof nodeData.height === "number" ? Math.max(nodeData.height, minHeight) : nodeData.height
    const nextWidth = typeof nodeData.width === "number" ? Math.max(nodeData.width, minWidth) : nodeData.width

    if (nextHeight === nodeData.height && nextWidth === nodeData.width) {
      return
    }

    node.setData({
      ...nodeData,
      width: nextWidth,
      height: nextHeight,
    })
    canvas.pushHistory(canvas.getData())
    this.scheduleRenderCanvas(canvas)
  }

  // LLM agent change: double-clicking a dialogue frame opens the same settings modal as the toolbar button.
  private openDialogueFrameFromDoubleClick(
    canvas: Canvas,
    event: MouseEvent,
    preventDefault: { value: boolean }
  ) {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const nodeEl = target.closest(".canvas-node.dialogue-canvas-frame-node") as HTMLElement | null

    if (!nodeEl) {
      return
    }

    const node = this.getCanvasNodes(canvas).find(candidate => this.getNodeElement(canvas, candidate) === nodeEl)

    if (!node) {
      return
    }

    const nodeData = node.getData() as CanvasNodeDataWithDialogue

    if (!nodeData["x-dialogue"]?.frame) {
      return
    }

    const choiceEl = target.closest(".dialogue-canvas-choice-row, .dialogue-canvas-choice-failure") as HTMLElement | null
    const focusTarget: DialogueFrameFocusTarget = choiceEl?.dataset.dialogueChoiceId
      ? { type: "choiceText", choiceId: choiceEl.dataset.dialogueChoiceId }
      : { type: "frameText" }

    preventDefault.value = true
    this.exitInlineEditing(node)
    // LLM agent change: double-clicking a dialogue frame opens modal editing, never inline canvas editing.
    void this.openEditFrameModal(canvas, node, focusTarget)
  }

  private exitInlineEditing(node: CanvasNode) {
    // LLM agent change: the first click of a double-click can leave native canvas inline editing active.
    node.setIsEditing(false)
    this.cleanInlineEditingDom(node)
    window.requestAnimationFrame(() => {
      node.setIsEditing(false)
      this.cleanInlineEditingDom(node)
    })
  }

  private cleanInlineEditingDom(node: CanvasNode) {
    const nodeEl = this.getNodeElement(node.canvas, node)

    if (!nodeEl) {
      return
    }

    nodeEl.removeClass("is-editing")
    nodeEl.removeClass("mod-editing")
    nodeEl.removeClass("is-focused")

    const activeElement = activeDocument.activeElement

    if (
      activeElement instanceof HTMLElement &&
      (activeElement.closest(".markdown-source-view") || activeElement.closest(".cm-editor")) &&
      nodeEl.contains(activeElement)
    ) {
      activeElement.blur()
    }
  }

  private applySpeakerMinHeight(
    nodeData: CanvasNodeDataWithDialogue,
    editorValue: DialogueFrameEditorValue
  ): Partial<CanvasNodeDataWithDialogue> {
    const hasSpeaker = true
    const hasChoices = (editorValue.choices?.length ?? 0) > 0
    const currentHeight = nodeData.height

    if ((!hasSpeaker && !hasChoices) || typeof currentHeight !== "number") {
      return {}
    }

    const minHeight = Math.max(
      hasSpeaker ? this.minSpeakerNodeHeight : 0,
      this.getMinimumNodeHeightForChoices(editorValue.choices ?? [])
    )
    const minWidth = hasSpeaker || hasChoices ? this.minDialogueNodeWidth : 0

    if (currentHeight >= minHeight && (typeof nodeData.width !== "number" || nodeData.width >= minWidth)) {
      return {}
    }

    return {
      width: typeof nodeData.width === "number" ? Math.max(nodeData.width, minWidth) : nodeData.width,
      height: minHeight,
    }
  }

  private scheduleRenderAllCanvases() {
    if (this.renderQueued) {
      return
    }

    this.renderQueued = true

    window.requestAnimationFrame(() => {
      this.renderQueued = false
      void this.renderAllCanvases()
    })
  }

  private scheduleRenderCanvas(canvas: Canvas) {
    if (this.renderFrames.has(canvas)) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      this.renderFrames.delete(canvas)
      void this.renderCanvas(canvas)
    })

    this.renderFrames.set(canvas, frameId)
  }

  private async renderAllCanvases() {
    const canvases = this.plugin.getCanvases?.() ?? []
    const [characters, stats] = await Promise.all([
      DialogueCharactersLoader.loadCharacters(this.plugin.app as any),
      DialogueStatsLoader.loadStats(this.plugin.app as any),
    ])

    for (const canvas of canvases) {
      this.renderCanvasWithCharacters(canvas, characters, stats)
    }
  }

  private async renderCanvas(canvas: Canvas) {
    const [characters, stats] = await Promise.all([
      DialogueCharactersLoader.loadCharacters(this.plugin.app as any),
      DialogueStatsLoader.loadStats(this.plugin.app as any),
    ])
    this.renderCanvasWithCharacters(canvas, characters, stats)
  }

  private renderCanvasWithCharacters(
    canvas: Canvas,
    characters: DialogueCharacterDefinition[],
    stats: DialogueStatDefinition[]
  ) {
    this.ensureCanvasObserver(canvas)

    const nodes = this.getCanvasNodes(canvas)

    for (const node of nodes) {
      this.renderStartNodeState(canvas, node)
      this.renderEndNodeState(canvas, node)
      this.renderNodeBadge(canvas, node, characters)
      this.renderNodeChoices(canvas, node, stats)
      this.renderNodeText(canvas, node)
      this.renderNodeActionIndicator(canvas, node)
    }
  }

  private renderStartNodeState(canvas: Canvas, node: CanvasNode) {
    const nodeEl = this.getNodeElement(canvas, node)

    if (!nodeEl) {
      return
    }

    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const isDialogueFrame = Boolean(nodeData["x-dialogue"]?.frame)

    if (!isDialogueFrame) {
      nodeEl.removeClass("dialogue-canvas-start-node")
      return
    }

    if (canvas.metadata["startNode"] === nodeData.id) {
      nodeEl.addClass("dialogue-canvas-start-node")
    } else {
      nodeEl.removeClass("dialogue-canvas-start-node")
    }
  }

  private renderEndNodeState(canvas: Canvas, node: CanvasNode) {
    const nodeEl = this.getNodeElement(canvas, node)

    if (!nodeEl) {
      return
    }

    const nodeData = node.getData() as CanvasNodeDataWithDialogue

    if (canvas.metadata["endNode"] === nodeData.id) {
      nodeEl.addClass("dialogue-canvas-end-node")
    } else {
      nodeEl.removeClass("dialogue-canvas-end-node")
    }
  }

  private ensureCanvasObserver(canvas: Canvas) {
    const wrapperEl = (canvas as any).wrapperEl as HTMLElement | undefined

    if (!wrapperEl || this.observedCanvasWrappers.has(wrapperEl)) {
      return
    }

    this.observedCanvasWrappers.add(wrapperEl)

    const suppressInlineEdit = (event: MouseEvent) => {
      this.suppressDialogueInlineEdit(canvas, event)
    }

    wrapperEl.addEventListener("mousedown", suppressInlineEdit, true)
    wrapperEl.addEventListener("click", suppressInlineEdit, true)

    const observer = new MutationObserver(mutations => {
      // LLM agent change: with the observer narrowed to direct childList only (no subtree, no
      // attributes), mutations here mean canvas-level nodes/edges were added or removed. We still
      // skip mutations caused by our own dialogue overlays (which live inside canvas-node subtrees
      // and won't appear as direct wrapperEl children, so this is mostly defensive) and schedule a
      // render otherwise.
      const hasRelevantMutation = mutations.some(mutation => {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node instanceof HTMLElement && (node.classList.contains("canvas-node") || node.classList.contains("canvas-edges"))) {
            return true
          }
        }
        for (const node of Array.from(mutation.removedNodes)) {
          if (node instanceof HTMLElement && (node.classList.contains("canvas-node") || node.classList.contains("canvas-edges"))) {
            return true
          }
        }
        return false
      })

      if (hasRelevantMutation) {
        this.scheduleRenderCanvas(canvas)
      }
    })

    // LLM agent change: childList only, no subtree / no attributes. Previously observed
    // wrapperEl with subtree+attributes(class,style), which fired the callback on every hover,
    // selection, drag and style change of any node — a major idle-CPU source. Canvas-level nodes
    // and edges are added/removed as direct children of wrapperEl, so childList alone catches the
    // structural changes we care about.
    observer.observe(wrapperEl, {
      childList: true,
    })

    this.plugin.register(() => {
      wrapperEl.removeEventListener("mousedown", suppressInlineEdit, true)
      wrapperEl.removeEventListener("click", suppressInlineEdit, true)
      observer.disconnect()
    })
  }

  private suppressDialogueInlineEdit(canvas: Canvas, event: MouseEvent) {
    if (event.detail < 2) {
      return
    }

    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const nodeEl = target.closest(".canvas-node.dialogue-canvas-frame-node") as HTMLElement | null

    if (!nodeEl) {
      return
    }

    const node = this.getCanvasNodes(canvas).find(candidate => this.getNodeElement(canvas, candidate) === nodeEl)

    if (!node) {
      return
    }

    const nodeData = node.getData() as CanvasNodeDataWithDialogue

    if (!nodeData["x-dialogue"]?.frame) {
      return
    }

    // LLM agent change: the second click of a double-click must not enter native inline markdown editing.
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    this.exitInlineEditing(node)
  }

  private getCanvasNodes(canvas: Canvas): CanvasNode[] {
    const nodesMap = (canvas as any).nodes

    if (!nodesMap?.values) {
      return []
    }

    return [...nodesMap.values()] as CanvasNode[]
  }

  // LLM agent change: dialogue text is rendered by the dialogue layer, so native markdown editing cannot disturb layout.
  private renderNodeText(canvas: Canvas, node: CanvasNode) {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const nodeEl = this.getNodeElement(canvas, node)

    if (!nodeEl) {
      return
    }

    if (!nodeData["x-dialogue"]?.frame) {
      nodeEl.querySelector(":scope > .dialogue-canvas-frame-text")?.remove()
      return
    }

    nodeEl.addClass("dialogue-canvas-frame-node")

    const text = nodeData.text ?? ""
    const textKey = JSON.stringify({
      text,
      speakerId: nodeData["x-dialogue"].frame.speakerId ?? "",
      choiceHeight: nodeEl.style.getPropertyValue("--dialogue-choice-list-height"),
    })
    const existingTextEl = nodeEl.querySelector(":scope > .dialogue-canvas-frame-text") as HTMLElement | null

    if (existingTextEl?.dataset.dialogueFrameTextKey === textKey) {
      return
    }

    existingTextEl?.remove()

    const textEl = activeDocument.createElement("div")
    textEl.addClass("dialogue-canvas-frame-text")
    textEl.dataset.dialogueFrameTextKey = textKey
    textEl.textContent = text

    nodeEl.appendChild(textEl)
  }

  // LLM agent change: frames with side effects get a compact visible action marker on the card.
  private renderNodeActionIndicator(canvas: Canvas, node: CanvasNode) {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const nodeEl = this.getNodeElement(canvas, node)

    if (!nodeEl) {
      return
    }

    const actionsCount = nodeData["x-dialogue"]?.frame?.actions?.length ?? 0

    if (actionsCount === 0) {
      nodeEl.querySelector(":scope > .dialogue-canvas-action-indicator")?.remove()
      return
    }

    const indicatorKey = String(actionsCount)
    const existingIndicator = nodeEl.querySelector(":scope > .dialogue-canvas-action-indicator") as HTMLElement | null

    if (existingIndicator?.dataset.dialogueActionKey === indicatorKey) {
      return
    }

    existingIndicator?.remove()

    const indicatorEl = activeDocument.createElement("div")
    indicatorEl.addClass("dialogue-canvas-action-indicator")
    indicatorEl.dataset.dialogueActionKey = indicatorKey
    indicatorEl.textContent = `ACT ${actionsCount}`

    nodeEl.appendChild(indicatorEl)
  }

  // LLM agent change: embedded choices are part of the frame node, so node height must reserve their rows.
  private getMinimumNodeHeightForChoices(choices: DialogueChoiceData[]): number {
    if (choices.length === 0) {
      return 0
    }

    const choicesHeight = choices.reduce((total, choice) => {
      return total + this.choiceRowHeight + (this.choiceHasFailureSlot(choice) ? this.choiceFailureRowHeight : 0)
    }, 0)

    return this.minFrameContentHeight + this.choicesTopGap + choicesHeight + this.choicesBottomPadding
  }

  // LLM agent change: frame choices are rendered as passive blocks inside the existing canvas node.
  private renderNodeChoices(canvas: Canvas, node: CanvasNode, stats: DialogueStatDefinition[]) {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const nodeEl = this.getNodeElement(canvas, node)

    if (!nodeEl) {
      return
    }

    const choices = nodeData["x-dialogue"]?.frame?.choices ?? []

    if (choices.length === 0) {
      nodeEl.querySelector(":scope > .dialogue-canvas-choice-list")?.remove()
      nodeEl.removeClass("dialogue-canvas-has-choices")
      nodeEl.style.removeProperty("--dialogue-choice-list-height")
      // LLM agent change: route edges can refresh after dialogue frame DOM changes.
      this.plugin.app.workspace.trigger("advanced-canvas:dialogue-frame-rendered", canvas, node)
      return
    }

    nodeEl.addClass("dialogue-canvas-has-choices")
    nodeEl.addClass("dialogue-canvas-frame-node")
    nodeEl.style.setProperty("--dialogue-choice-list-height", `${this.getChoiceListHeight(choices)}px`)

    const linkedRoutes = this.getLinkedChoiceRoutes(canvas, node)
    const choiceKey = JSON.stringify({
      choices,
      linkedRoutes: [...linkedRoutes].sort(),
      stats: stats.map(stat => [stat.id, stat.icon ?? ""]),
    })
    const existingList = nodeEl.querySelector(
      ":scope > .dialogue-canvas-choice-list"
    ) as HTMLElement | null

    if (existingList?.dataset.dialogueChoiceKey === choiceKey) {
      // LLM agent change: even unchanged choice DOM may be needed as a fresh edge anchor after native canvas renders.
      this.plugin.app.workspace.trigger("advanced-canvas:dialogue-frame-rendered", canvas, node)
      return
    }

    existingList?.remove()

    const listEl = activeDocument.createElement("div")
    listEl.addClass("dialogue-canvas-choice-list")
    listEl.dataset.dialogueChoiceKey = choiceKey

    choices.forEach((choice, index) => {
      const choiceEl = activeDocument.createElement("div")
      choiceEl.addClass("dialogue-canvas-choice-row")
      choiceEl.dataset.dialogueChoiceId = choice.choiceId
      choiceEl.style.setProperty("--dialogue-choice-success-color", this.getChoiceSuccessColor(index))
      choiceEl.style.setProperty("--dialogue-choice-failure-color", this.getChoiceFailureColor(index))

      const swatchEl = choiceEl.createDiv()
      swatchEl.addClass("dialogue-canvas-choice-swatch")
      swatchEl.dataset.dialogueChoiceId = choice.choiceId
      swatchEl.dataset.dialogueChoiceOutcome = "success"

      if (linkedRoutes.has(this.getChoiceRouteKey(choice.choiceId, "success"))) {
        swatchEl.addClass("dialogue-canvas-choice-route-port")
      }

      const textEl = choiceEl.createDiv()
      textEl.addClass("dialogue-canvas-choice-text")
      textEl.textContent = choice.text

      const metaEl = choiceEl.createDiv()
      metaEl.addClass("dialogue-canvas-choice-meta")

      this.renderChoiceStatBadges(metaEl, choice, stats)

      if (this.choiceHasFailureSlot(choice)) {
        const failureEl = activeDocument.createElement("div")
        failureEl.addClass("dialogue-canvas-choice-failure")
        failureEl.dataset.dialogueChoiceId = choice.choiceId

        const failureTextEl = failureEl.createDiv()
        failureTextEl.addClass("dialogue-canvas-choice-failure-text")
        failureTextEl.textContent = "fail"

        const failurePortEl = failureEl.createDiv()
        failurePortEl.addClass("dialogue-canvas-choice-failure-port")
        failurePortEl.dataset.dialogueChoiceId = choice.choiceId
        failurePortEl.dataset.dialogueChoiceOutcome = "failure"

        if (linkedRoutes.has(this.getChoiceRouteKey(choice.choiceId, "failure"))) {
          failurePortEl.addClass("dialogue-canvas-choice-route-port")
        }

        choiceEl.appendChild(failureEl)
      }

      listEl.appendChild(choiceEl)
    })

    nodeEl.appendChild(listEl)
    // LLM agent change: choice route edges anchor to this freshly rendered DOM.
    this.plugin.app.workspace.trigger("advanced-canvas:dialogue-frame-rendered", canvas, node)
  }

  private choiceHasFailureSlot(choice: DialogueChoiceData): boolean {
    return (
      (choice.checks?.items?.length ?? 0) > 0 ||
      (choice.conditions?.items?.length ?? 0) > 0
    )
  }

  private getChoiceSuccessColor(index: number): string {
    return `var(--dialogue-choice-color-${index % 8 + 1})`
  }

  private getChoiceFailureColor(index: number): string {
    // LLM agent change: failure rows reuse the choice hue, but with the darker failure variant.
    return `var(--dialogue-choice-failure-color-${index % 8 + 1})`
  }

  private getChoiceListHeight(choices: DialogueChoiceData[]): number {
    return choices.reduce((total, choice, index) => {
      const gap = index === 0 ? 0 : 4
      return total + gap + this.choiceRowHeight + (this.choiceHasFailureSlot(choice) ? this.choiceFailureRowHeight : 0)
    }, 0)
  }

  private getLinkedChoiceRoutes(canvas: Canvas, node: CanvasNode): Set<string> {
    const routes = new Set<string>()

    for (const edge of canvas.edges.values()) {
      const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
      const route = edgeData["x-dialogue"]?.route

      if (
        edgeData.fromNode === node.id &&
        route?.type === "choice" &&
        route.choiceId &&
        route.outcome
      ) {
        routes.add(this.getChoiceRouteKey(route.choiceId, route.outcome))
      }
    }

    return routes
  }

  private getChoiceRouteKey(choiceId: string, outcome: DialogueChoiceRouteOutcome): string {
    return `${choiceId}:${outcome}`
  }

  private renderChoiceStatBadges(
    metaEl: HTMLElement,
    choice: DialogueChoiceData,
    stats: DialogueStatDefinition[]
  ) {
    const statById = new Map(stats.map(stat => [stat.id, stat]))

    for (const check of choice.checks?.items ?? []) {
      const stat = statById.get(check.statId)
      this.createChoiceStatBadge(metaEl, stat, check.threshold)
    }

    for (const condition of choice.conditions?.items ?? []) {
      if (condition.source !== "stat") {
        continue
      }

      const stat = statById.get(condition.id)
      this.createChoiceStatBadge(metaEl, stat, condition.value, condition.op)
    }
  }

  private createChoiceStatBadge(
    metaEl: HTMLElement,
    stat: DialogueStatDefinition | undefined,
    value: unknown,
    operator?: string
  ) {
    const badgeEl = metaEl.createSpan()
    badgeEl.addClass("dialogue-canvas-choice-stat-badge")
    badgeEl.createSpan({
      cls: "dialogue-canvas-choice-stat-icon",
      text: stat?.icon || stat?.name?.slice(0, 1) || "?",
    })
    badgeEl.createSpan({
      cls: "dialogue-canvas-choice-stat-value",
      text: `${operator && operator !== ">=" ? operator : ""}${String(value ?? "")}`,
    })
  }

  private renderNodeBadge(
    canvas: Canvas,
    node: CanvasNode,
    characters: DialogueCharacterDefinition[]
  ) {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const nodeEl = this.getNodeElement(canvas, node)

    if (!nodeEl) {
      return
    }

    const frameMeta = nodeData["x-dialogue"]?.frame
    const speakerId = frameMeta?.speakerId

    if (!frameMeta) {
      nodeEl.querySelector(":scope > .dialogue-canvas-character-header")?.remove()
      nodeEl.removeClass("dialogue-canvas-frame-node")
      return
    }

    const character = speakerId ? characters.find(item => item.id === speakerId) : undefined

    const headerColor = character ? this.getNodeAccentColor(nodeData, nodeEl, character) : undefined

    const headerKey = JSON.stringify({
      speakerId: character?.id ?? "",
      name: character?.name ?? "текст",
      description: character?.description ?? "",
      portrait: character?.portrait ?? "",
      color: headerColor ?? character?.color ?? "",
    })

    const existingHeader = nodeEl.querySelector(
      ":scope > .dialogue-canvas-character-header"
    ) as HTMLElement | null

    if (existingHeader?.dataset.dialogueHeaderKey === headerKey) {
      return
    }

    existingHeader?.remove()

    nodeEl.addClass("dialogue-canvas-frame-node")
    nodeEl.addClass("dialogue-canvas-has-speaker")

    const header = activeDocument.createElement("div")
    header.addClass("dialogue-canvas-character-header")
    header.dataset.dialogueHeaderKey = headerKey

    header.style.removeProperty("--dialogue-character-color")

    if (headerColor) {
      header.style.setProperty("--dialogue-character-color", headerColor)
    }

    const portraitEl = header.createDiv()
    portraitEl.addClass("dialogue-canvas-character-portrait")

    if (character?.portrait) {
      const image = portraitEl.createEl("img")
      image.src = this.resolveVaultImagePath(character.portrait)
      image.alt = character.name
    } else if (character) {
      portraitEl.textContent = this.getInitials(character.name)
    } else {
      // LLM agent change: text-only dialogue frames use a pen mark instead of an empty portrait slot.
      portraitEl.textContent = "✎"
    }

    const labelEl = header.createDiv()
    labelEl.addClass("dialogue-canvas-character-label")

    const nameEl = labelEl.createDiv()
    nameEl.addClass("dialogue-canvas-character-name")
    nameEl.textContent = character?.name ?? "текст"

    if (character?.description) {
      const descriptionEl = labelEl.createDiv()
      descriptionEl.addClass("dialogue-canvas-character-description")
      descriptionEl.textContent = character.description
    }

    nodeEl.appendChild(header)
  }

  private getNodeElement(canvas: Canvas, node: CanvasNode): HTMLElement | null {
    const anyNode = node as any

    if (anyNode.nodeEl instanceof HTMLElement) {
      return anyNode.nodeEl
    }

    if (anyNode.el instanceof HTMLElement) {
      return anyNode.el
    }

    if (anyNode.containerEl instanceof HTMLElement) {
      return anyNode.containerEl.closest(".canvas-node") as HTMLElement | null
    }

    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const escapedId = this.escapeCss(nodeData.id)
    const wrapperEl = (canvas as any).wrapperEl as HTMLElement | undefined

    if (!wrapperEl) {
      return null
    }

    const direct =
      wrapperEl.querySelector(`.canvas-node[data-id="${escapedId}"]`) ??
      wrapperEl.querySelector(`.canvas-node[data-node-id="${escapedId}"]`) ??
      wrapperEl.querySelector(`[data-id="${escapedId}"].canvas-node`)

    if (direct instanceof HTMLElement) {
      return direct
    }

    // LLM agent change: use Array.from instead of the spread operator — Nodelist's
    // Symbol.iterator isn't in the TS lib config here, so `[...querySelectorAll]` errored.
    const allNodes = Array.from(wrapperEl.querySelectorAll(".canvas-node")) as HTMLElement[]

    return allNodes.find(element => {
      return (
        element.dataset.id === nodeData.id ||
        element.dataset.nodeId === nodeData.id ||
        element.getAttribute("data-id") === nodeData.id ||
        element.getAttribute("data-node-id") === nodeData.id
      )
    }) ?? null
  }

  private getNodeAccentColor(
    nodeData: CanvasNodeDataWithDialogue,
    nodeEl: HTMLElement,
    character: DialogueCharacterDefinition
  ): string | undefined {
    const rawNodeColor = nodeData.color

    const nodeDataColor = this.normalizeCanvasColor(rawNodeColor)
    if (nodeDataColor) {
      return nodeDataColor
    }

    const computedColor = this.getComputedNodeColor(nodeEl)
    if (computedColor) {
      return computedColor
    }

    if (this.isUsableCssColor(character.color)) {
      return character.color
    }

    return undefined
  }

  private normalizeCanvasColor(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined
    }

    const color = value.trim()

    if (!color) {
      return undefined
    }

    if (this.isUsableCssColor(color)) {
      return color
    }

    // Если Obsidian хранит цвет как индекс "1", "2" и т.п.,
    // не возвращаем var(...), потому что он может быть невалиден вне ноды.
    return undefined
  }

  private getComputedNodeColor(nodeEl: HTMLElement): string | undefined {
    const candidates: HTMLElement[] = [
      nodeEl,
      nodeEl.querySelector(".canvas-node-container") as HTMLElement,
      nodeEl.querySelector(".canvas-node-content") as HTMLElement,
    ].filter((element): element is HTMLElement => element instanceof HTMLElement)

    for (const element of candidates) {
      const style = getComputedStyle(element)

      const shadowVariables = [
        "--shadow-border-themed",
        "--shadow-border-themed-inset",
        "--shadow-border-accent",
        "--shadow-border-accent-inset",
      ]

      for (const variableName of shadowVariables) {
        const rawValue = style.getPropertyValue(variableName).trim()
        const extractedColor = this.extractColorFromCssValue(rawValue)

        if (extractedColor) {
          return extractedColor
        }
      }

      const directColors = [
        style.borderTopColor,
        style.borderRightColor,
        style.borderBottomColor,
        style.borderLeftColor,
        style.outlineColor,
      ]

      for (const color of directColors) {
        if (this.isUsableCssColor(color)) {
          return color
        }
      }
    }

    return undefined
  }

  private extractColorFromCssValue(value: string | undefined): string | undefined {
    if (!value) {
      return undefined
    }

    const trimmed = value.trim()

    // LLM agent change: use a plain boolean check (not the `isUsableCssColor` type guard)
    // here, because applying a `value is string` guard to `trimmed` (already `string`) narrows
    // it to `never` in the branches below, breaking the `.match` calls.
    if (this.isUsableCssColor(trimmed)) {
      return trimmed
    }

    const rest: string = trimmed
    const rgbMatch = rest.match(/rgba?\([^)]+\)/i)
    if (rgbMatch) {
      return rgbMatch[0]
    }

    const hslMatch = rest.match(/hsla?\([^)]+\)/i)
    if (hslMatch) {
      return hslMatch[0]
    }

    const hexMatch = rest.match(/#[0-9a-f]{3,8}\b/i)
    if (hexMatch) {
      return hexMatch[0]
    }

    return undefined
  }

  private isUsableCssColor(value: string | undefined): value is string {
    if (!value) {
      return false
    }

    const color = value.trim().toLowerCase()

    if (
      color.length === 0 ||
      color === "transparent" ||
      color === "rgba(0, 0, 0, 0)" ||
      color === "rgba(0,0,0,0)" ||
      color === "initial" ||
      color === "inherit" ||
      color === "unset"
    ) {
      return false
    }

    if (color.startsWith("var(")) {
      return false
    }

    return (
      color.startsWith("#") ||
      color.startsWith("rgb(") ||
      color.startsWith("rgba(") ||
      color.startsWith("hsl(") ||
      color.startsWith("hsla(")
    )
  }

  private resolveVaultImagePath(path: string): string {
    const trimmed = path.trim()

    if (!trimmed) {
      return ""
    }

    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("app://") ||
      trimmed.startsWith("data:")
    ) {
      return trimmed
    }

    const file = this.plugin.app.vault.getAbstractFileByPath(trimmed)

    if (file instanceof TFile) {
      const getResourcePath = (this.plugin.app.vault as any).getResourcePath

      if (typeof getResourcePath === "function") {
        return getResourcePath.call(this.plugin.app.vault, file)
      }
    }

    const adapter = (this.plugin.app.vault as any).adapter
    const getResourcePath = adapter?.getResourcePath

    if (typeof getResourcePath === "function") {
      return getResourcePath.call(adapter, trimmed)
    }

    return trimmed
  }

  private getInitials(name: string): string {
    const cleanName = name.trim()

    if (!cleanName) {
      return "?"
    }

    return cleanName
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() ?? "")
      .join("")
  }

  private escapeCss(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value)
    }

    return value.replace(/"/g, '\\"')
  }

  private generateFrameId(text: string): string {
    const normalized = text
      .toLowerCase()
      .trim()
      .replace(/<[^>]*>/g, "")
      .replace(/[^a-zа-яё0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")

    return normalized.slice(0, 48) || "frame"
  }
}
