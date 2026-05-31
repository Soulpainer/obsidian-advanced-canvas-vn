import { Notice, TFile } from "obsidian"
import { Canvas, CanvasElement, CanvasNode } from "src/@types/Canvas"
import {
  DialogueCharacterDefinition,
  DialogueFrameEditorValue,
  DialogueNodeData,
} from "src/@types/DialogueCanvas"
import CanvasHelper from "src/utils/canvas-helper"
import CanvasExtension from "./canvas-extension"
import DialogueCharactersLoader from "src/utils/dialogue-characters-loader"
import EditDialogueFrameModal from "src/modals/edit-dialogue-frame-modal"

type CanvasNodeDataWithDialogue = ReturnType<CanvasNode["getData"]> & {
  id: string
  type?: string
  text?: string
  height?: number
  color?: string
  ["x-dialogue"]?: DialogueNodeData
}

export default class DialogueFrameCanvasExtension extends CanvasExtension {
  private renderQueued = false

  // Минимальная высота карточки, если у неё есть speaker.
  // Подгони под свой шаг сетки.
  private readonly minSpeakerNodeHeight = 160

  private readonly observedCanvasWrappers = new WeakSet<HTMLElement>()

  isEnabled() {
    return true
  }

  init() {
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
      this.plugin.app.workspace.on("active-leaf-change", () => {
        this.scheduleRenderAllCanvases()
      })
    )

    this.scheduleRenderAllCanvases()
  }

  private onPopupMenuCreated(canvas: Canvas) {
    const selectedNodes = this.getSelectedNodes(canvas)

    if (canvas.readonly || selectedNodes.length !== 1) {
      return
    }

    const nodeData = selectedNodes[0]!.getData() as CanvasNodeDataWithDialogue

    if (nodeData.type && nodeData.type !== "text") {
      return
    }

    CanvasHelper.addPopupMenuOption(
      canvas,
      CanvasHelper.createPopupMenuOption({
        id: "dialogue-canvas-edit-frame",
        icon: "user-round",
        label: "Edit Frame",
        callback: () => this.openEditFrameModal(canvas, selectedNodes[0]!),
      })
    )
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

  private async openEditFrameModal(canvas: Canvas, node: CanvasNode) {
    const nodeData = node.getData() as CanvasNodeDataWithDialogue
    const frameMeta = nodeData["x-dialogue"]?.frame
    const characters = await DialogueCharactersLoader.loadCharacters(this.plugin.app as any)

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
    }

    new EditDialogueFrameModal(this.plugin.app as any, {
      initialValue,
      characters,
      onSubmit: value => {
        this.saveDialogueFrame(canvas, node, value)
      },
    }).open()
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
        },
      },
    }

    node.setData(nextData)
    canvas.pushHistory(canvas.getData())

    new Notice("Dialogue Canvas: Frame saved")
    console.log("[Dialogue Canvas] Saved frame data", nextData)

    this.scheduleRenderCanvas(canvas)
  }

  private applySpeakerMinHeight(
    nodeData: CanvasNodeDataWithDialogue,
    editorValue: DialogueFrameEditorValue
  ): Partial<CanvasNodeDataWithDialogue> {
    const hasSpeaker = Boolean(editorValue.speakerId)
    const currentHeight = nodeData.height

    if (!hasSpeaker || typeof currentHeight !== "number") {
      return {}
    }

    if (currentHeight >= this.minSpeakerNodeHeight) {
      return {}
    }

    return {
      height: this.minSpeakerNodeHeight,
    }
  }

  private scheduleRenderAllCanvases() {
    if (this.renderQueued) {
      return
    }

    this.renderQueued = true

    window.setTimeout(() => {
      this.renderQueued = false
      void this.renderAllCanvases()
    }, 100)
  }

  private scheduleRenderCanvas(canvas: Canvas) {
    window.setTimeout(() => {
      void this.renderCanvas(canvas)
    }, 100)
  }

  private async renderAllCanvases() {
    const canvases = this.plugin.getCanvases?.() ?? []
    const characters = await DialogueCharactersLoader.loadCharacters(this.plugin.app as any)

    for (const canvas of canvases) {
      this.renderCanvasWithCharacters(canvas, characters)
    }
  }

  private async renderCanvas(canvas: Canvas) {
    const characters = await DialogueCharactersLoader.loadCharacters(this.plugin.app as any)
    this.renderCanvasWithCharacters(canvas, characters)
  }

  private renderCanvasWithCharacters(
    canvas: Canvas,
    characters: DialogueCharacterDefinition[]
  ) {
    this.ensureCanvasObserver(canvas)

    const nodes = this.getCanvasNodes(canvas)

    for (const node of nodes) {
      this.renderNodeBadge(canvas, node, characters)
    }
  }

  private ensureCanvasObserver(canvas: Canvas) {
    const wrapperEl = (canvas as any).wrapperEl as HTMLElement | undefined

    if (!wrapperEl || this.observedCanvasWrappers.has(wrapperEl)) {
      return
    }

    this.observedCanvasWrappers.add(wrapperEl)

    const observer = new MutationObserver(mutations => {
      const hasRelevantMutation = mutations.some(mutation => {
        const target = mutation.target

        if (!(target instanceof HTMLElement)) {
          return false
        }

        // Игнорируем собственные изменения бейджа, чтобы не гонять цикл.
        if (target.closest(".dialogue-canvas-character-badge")) {
          return false
        }

        return (
          target.classList.contains("canvas-node") ||
          target.closest(".canvas-node") !== null
        )
      })

      if (hasRelevantMutation) {
        this.scheduleRenderCanvas(canvas)
      }
    })

    observer.observe(wrapperEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    })

    this.plugin.register(() => {
      observer.disconnect()
    })
  }

  private getCanvasNodes(canvas: Canvas): CanvasNode[] {
    const nodesMap = (canvas as any).nodes

    if (!nodesMap?.values) {
      return []
    }

    return [...nodesMap.values()] as CanvasNode[]
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

    if (!speakerId) {
      nodeEl.querySelector(":scope > .dialogue-canvas-character-badge")?.remove()
      nodeEl.removeClass("dialogue-canvas-frame-node")
      return
    }

    const character = characters.find(item => item.id === speakerId)

    if (!character) {
      nodeEl.querySelector(":scope > .dialogue-canvas-character-badge")?.remove()
      nodeEl.removeClass("dialogue-canvas-frame-node")
      return
    }

    const badgeColor = this.getNodeAccentColor(nodeData, nodeEl, character)

    const badgeKey = JSON.stringify({
      speakerId: character.id,
      name: character.name,
      portrait: character.portrait ?? "",
      color: badgeColor ?? character.color ?? "",
    })

    const existingBadge = nodeEl.querySelector(
      ":scope > .dialogue-canvas-character-badge"
    ) as HTMLElement | null

    if (existingBadge?.dataset.dialogueBadgeKey === badgeKey) {
      return
    }

    existingBadge?.remove()

    nodeEl.addClass("dialogue-canvas-frame-node")

    const badge = activeDocument.createElement("div")
    badge.addClass("dialogue-canvas-character-badge")
    badge.dataset.dialogueBadgeKey = badgeKey

    badge.style.removeProperty("--dialogue-character-color")

    if (badgeColor) {
      badge.style.setProperty("--dialogue-character-color", badgeColor)
    }

    const portraitEl = badge.createDiv()
    portraitEl.addClass("dialogue-canvas-character-portrait")

    if (character.portrait) {
      const image = portraitEl.createEl("img")
      image.src = this.resolveVaultImagePath(character.portrait)
      image.alt = character.name
    } else {
      portraitEl.textContent = this.getInitials(character.name)
    }

    const nameEl = badge.createDiv()
    nameEl.addClass("dialogue-canvas-character-name")
    nameEl.textContent = character.name

    nodeEl.appendChild(badge)
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

    const allNodes = [...wrapperEl.querySelectorAll(".canvas-node")] as HTMLElement[]

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

    if (this.isUsableCssColor(trimmed)) {
      return trimmed
    }

    const rgbMatch = trimmed.match(/rgba?\([^)]+\)/i)
    if (rgbMatch) {
      return rgbMatch[0]
    }

    const hslMatch = trimmed.match(/hsla?\([^)]+\)/i)
    if (hslMatch) {
      return hslMatch[0]
    }

    const hexMatch = trimmed.match(/#[0-9a-f]{3,8}\b/i)
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