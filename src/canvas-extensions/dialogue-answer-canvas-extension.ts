import { Notice } from "obsidian"
import { Canvas, CanvasEdge, CanvasElement } from "src/@types/Canvas"
import { DialogueAnswerChecksData, DialogueAnswerData, DialogueEdgeData } from "src/@types/DialogueCanvas"
import CanvasHelper from "src/utils/canvas-helper"
import CanvasExtension from "./canvas-extension"
import EditDialogueAnswerModal from "src/modals/edit-dialogue-answer-modal"
import EditDialogueChecksModal from "src/modals/edit-dialogue-checks-modal"
import DialogueStatsLoader from "src/utils/dialogue-stats-loader"

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
  }

  private getSelectedEdges(canvas: Canvas): CanvasEdge[] {
    return [...canvas.selection].filter((item: CanvasElement) =>
      (item as CanvasEdge).path !== undefined
    ) as CanvasEdge[]
  }

  private openEditAnswerModal(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const dialogueData = edgeData["x-dialogue"]?.answer

    const cleanLabel = this.stripDicePrefix(edgeData.label ?? "")

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
    }

    const nextData: CanvasEdgeDataWithDialogue = {
      ...edgeData,

      label: this.buildEdgeLabel(nextAnswer),

      "x-dialogue": {
        ...edgeData["x-dialogue"],
        answer: nextAnswer,
      },
    }

    edge.setData(nextData)
    canvas.pushHistory(canvas.getData())

    new Notice("Dialogue Canvas: Answer saved")
    console.log("[Dialogue Canvas] Saved answer data", nextData)
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
      this.stripDicePrefix(edgeData.label ?? "")

    const answerId =
      existingAnswer?.answerId ??
      this.generateAnswerId(cleanText)

    const nextAnswer: DialogueAnswerData = {
      answerId,
      text: cleanText,
      hideWhenUnavailable: existingAnswer?.hideWhenUnavailable ?? true,
      checks,
    }

    const nextData: CanvasEdgeDataWithDialogue = {
      ...edgeData,

      label: this.buildEdgeLabel(nextAnswer),

      "x-dialogue": {
        ...edgeData["x-dialogue"],
        answer: nextAnswer,
      },
    }

    edge.setData(nextData)
    canvas.pushHistory(canvas.getData())

    new Notice("Dialogue Canvas: Checks saved")
    console.log("[Dialogue Canvas] Saved checks", nextData)
  }

  private buildEdgeLabel(answer: DialogueAnswerData): string {
    const hasChecks = (answer.checks?.items?.length ?? 0) > 0
    return hasChecks ? `🎲 ${answer.text}` : answer.text
  }

  private stripDicePrefix(label: string): string {
    return label.replace(/^(🎲\s*)+/u, "")
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