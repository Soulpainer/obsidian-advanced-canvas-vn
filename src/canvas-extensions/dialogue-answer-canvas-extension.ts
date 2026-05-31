import { Notice } from "obsidian"
import { Canvas, CanvasEdge, CanvasElement } from "src/@types/Canvas"
import { DialogueEdgeData, DialogueAnswerData } from "src/@types/DialogueCanvas"
import CanvasHelper from "src/utils/canvas-helper"
import CanvasExtension from "./canvas-extension"
import EditDialogueAnswerModal from "src/modals/edit-dialogue-answer-modal"

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
  }

  private getSelectedEdges(canvas: Canvas): CanvasEdge[] {
    return [...canvas.selection].filter((item: CanvasElement) =>
      (item as CanvasEdge).path !== undefined
    ) as CanvasEdge[]
  }

  private openEditAnswerModal(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const dialogueData = edgeData["x-dialogue"]?.answer

    const initialValue: DialogueAnswerData = {
      answerId:
        dialogueData?.answerId ??
        this.generateAnswerId(edgeData.label ?? ""),

      text:
        dialogueData?.text ??
        edgeData.label ??
        "",

      hideWhenUnavailable:
        dialogueData?.hideWhenUnavailable ?? true,
    }

    new EditDialogueAnswerModal(this.plugin.app, {
      initialValue,
      onSubmit: value => {
        this.saveDialogueAnswer(canvas, edge, value)
      },
    }).open()
  }

  private saveDialogueAnswer(
    canvas: Canvas,
    edge: CanvasEdge,
    answerData: DialogueAnswerData
  ) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue

    const nextData: CanvasEdgeDataWithDialogue = {
      ...edgeData,

      // Важно: label остаётся обычной подписью стрелки в Canvas.
      label: answerData.text,

      // А игровые данные храним отдельно.
      "x-dialogue": {
        ...edgeData["x-dialogue"],
        answer: {
          answerId: answerData.answerId,
          text: answerData.text,
          hideWhenUnavailable: answerData.hideWhenUnavailable ?? true,
        },
      },
    }

    edge.setData(nextData)
    canvas.pushHistory(canvas.getData())

    new Notice("Dialogue Canvas: Answer saved")
    console.log("[Dialogue Canvas] Saved answer data", nextData)
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