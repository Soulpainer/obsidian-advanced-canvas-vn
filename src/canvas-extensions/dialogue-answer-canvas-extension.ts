import { Notice } from "obsidian"
import { Canvas, CanvasEdge, CanvasElement } from "src/@types/Canvas"
import {
  DialogueAnswerChecksData,
  DialogueAnswerConditionsData,
  DialogueAnswerData,
  DialogueEdgeData,
} from "src/@types/DialogueCanvas"
import CanvasHelper from "src/utils/canvas-helper"
import CanvasExtension from "./canvas-extension"
import EditDialogueAnswerModal from "src/modals/edit-dialogue-answer-modal"
import EditDialogueChecksModal from "src/modals/edit-dialogue-checks-modal"
import EditDialogueConditionsModal from "src/modals/edit-dialogue-conditions-modal"
import DialogueStatsLoader from "src/utils/dialogue-stats-loader"
import DialoguePropertiesLoader from "src/utils/dialogue-properties-loader"

type CanvasEdgeDataWithDialogue = ReturnType<CanvasEdge["getData"]> & {
  label?: string
  ["x-dialogue"]?: DialogueEdgeData
}

export default class DialogueAnswerCanvasExtension extends CanvasExtension {
  isEnabled() {
    return true
  }

  init() {
    console.log("[Dialogue Canvas] DialogueAnswerCanvasExtension init")

    this.plugin.registerEvent(
      this.plugin.app.workspace.on(
        "advanced-canvas:popup-menu-created",
        (canvas: Canvas) => this.onPopupMenuCreated(canvas)
      )
    )
  }

  private onPopupMenuCreated(canvas: Canvas) {
    const selectedEdges = this.getSelectedEdges(canvas)

    if (canvas.readonly || selectedEdges.length !== 1) {
      return
    }

    CanvasHelper.addPopupMenuOption(
      canvas,
      CanvasHelper.createPopupMenuOption({
        id: "dialogue-canvas-edit-answer",
        icon: "message-square-text",
        label: "Edit Answer",
        callback: () => this.openEditAnswerModal(canvas, selectedEdges[0]!),
      })
    )

    CanvasHelper.addPopupMenuOption(
      canvas,
      CanvasHelper.createPopupMenuOption({
        id: "dialogue-canvas-edit-checks",
        icon: "dice-5",
        label: "Edit Checks",
        callback: () => this.openEditChecksModal(canvas, selectedEdges[0]!),
      })
    )

    CanvasHelper.addPopupMenuOption(
      canvas,
      CanvasHelper.createPopupMenuOption({
        id: "dialogue-canvas-edit-conditions",
        icon: "list-filter",
        label: "Edit Conditions",
        callback: () => this.openEditConditionsModal(canvas, selectedEdges[0]!),
      })
    )
  }

  private getSelectedEdges(canvas: Canvas): CanvasEdge[] {
    return [...canvas.selection].filter((item: CanvasElement) =>
      (item as CanvasEdge).path !== undefined
    ) as CanvasEdge[]
  }

  private openEditAnswerModal(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const dialogueData = edgeData["x-dialogue"]?.answer

    const cleanLabel = this.stripLabelPrefixes(edgeData.label ?? "")

    const initialValue: DialogueAnswerData = {
      answerId:
        dialogueData?.answerId ??
        this.generateAnswerId(cleanLabel),

      text:
        dialogueData?.text ??
        cleanLabel,

      hideWhenUnavailable:
        dialogueData?.hideWhenUnavailable ?? true,

      checks:
        dialogueData?.checks,

      conditions:
        dialogueData?.conditions,
    }

    new EditDialogueAnswerModal(this.plugin.app as any, {
      initialValue,
      onSubmit: value => {
        this.saveDialogueAnswer(canvas, edge, value)
      },
    }).open()
  }

  private async openEditChecksModal(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const stats = await DialogueStatsLoader.loadStats(this.plugin.app as any)

    new EditDialogueChecksModal(this.plugin.app as any, {
      stats,
      initialValue: edgeData["x-dialogue"]?.answer?.checks,
      onSubmit: value => {
        this.saveDialogueChecks(canvas, edge, value)
      },
    }).open()
  }

  private async openEditConditionsModal(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue

    const [stats, properties] = await Promise.all([
      DialogueStatsLoader.loadStats(this.plugin.app as any),
      DialoguePropertiesLoader.loadProperties(this.plugin.app as any),
    ])

    new EditDialogueConditionsModal(this.plugin.app as any, {
      stats,
      properties,
      initialValue: edgeData["x-dialogue"]?.answer?.conditions,
      onSubmit: value => {
        this.saveDialogueConditions(canvas, edge, value)
      },
    }).open()
  }

  private saveDialogueAnswer(
    canvas: Canvas,
    edge: CanvasEdge,
    answerData: DialogueAnswerData
  ) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const existingAnswer = edgeData["x-dialogue"]?.answer

    const nextAnswer: DialogueAnswerData = {
      answerId: answerData.answerId,
      text: answerData.text,
      hideWhenUnavailable: answerData.hideWhenUnavailable ?? true,
      checks: existingAnswer?.checks ?? answerData.checks,
      conditions: existingAnswer?.conditions ?? answerData.conditions,
    }

    this.saveAnswerData(canvas, edge, nextAnswer, "Dialogue Canvas: Answer saved")
  }

  private saveDialogueChecks(
    canvas: Canvas,
    edge: CanvasEdge,
    checks: DialogueAnswerChecksData | undefined
  ) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const existingAnswer = edgeData["x-dialogue"]?.answer

    const cleanText =
      existingAnswer?.text ??
      this.stripLabelPrefixes(edgeData.label ?? "")

    const answerId =
      existingAnswer?.answerId ??
      this.generateAnswerId(cleanText)

    const nextAnswer: DialogueAnswerData = {
      answerId,
      text: cleanText,
      hideWhenUnavailable: existingAnswer?.hideWhenUnavailable ?? true,
      checks,
      conditions: existingAnswer?.conditions,
    }

    this.saveAnswerData(canvas, edge, nextAnswer, "Dialogue Canvas: Checks saved")
  }

  private saveDialogueConditions(
    canvas: Canvas,
    edge: CanvasEdge,
    conditions: DialogueAnswerConditionsData | undefined
  ) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const existingAnswer = edgeData["x-dialogue"]?.answer

    const cleanText =
      existingAnswer?.text ??
      this.stripLabelPrefixes(edgeData.label ?? "")

    const answerId =
      existingAnswer?.answerId ??
      this.generateAnswerId(cleanText)

    const nextAnswer: DialogueAnswerData = {
      answerId,
      text: cleanText,
      hideWhenUnavailable: existingAnswer?.hideWhenUnavailable ?? true,
      checks: existingAnswer?.checks,
      conditions,
    }

    this.saveAnswerData(canvas, edge, nextAnswer, "Dialogue Canvas: Conditions saved")
  }

  private saveAnswerData(
    canvas: Canvas,
    edge: CanvasEdge,
    answer: DialogueAnswerData,
    notice: string
  ) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue

    const nextData: CanvasEdgeDataWithDialogue = {
      ...edgeData,

      label: this.buildEdgeLabel(answer),

      "x-dialogue": {
        ...edgeData["x-dialogue"],
        answer,
      },
    }

    edge.setData(nextData)
    canvas.pushHistory(canvas.getData())

    new Notice(notice)
    console.log("[Dialogue Canvas] Saved answer data", nextData)
  }

  private buildEdgeLabel(answer: DialogueAnswerData): string {
    const hasChecks = (answer.checks?.items?.length ?? 0) > 0
    const hasConditions = (answer.conditions?.items?.length ?? 0) > 0

    const prefixes: string[] = []

    if (hasChecks) {
      prefixes.push("🎲")
    }

    if (hasConditions) {
      prefixes.push("🔒")
    }

    return prefixes.length > 0
      ? `${prefixes.join(" ")} ${answer.text}`
      : answer.text
  }

  private stripLabelPrefixes(label: string): string {
    return label.replace(/^((🎲|🔒)\s*)+/u, "")
  }

  private generateAnswerId(label: string): string {
    const normalized = label
      .toLowerCase()
      .trim()
      .replace(/<[^>]*>/g, "")
      .replace(/[^a-zа-яё0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")

    return normalized || "answer"
  }
}