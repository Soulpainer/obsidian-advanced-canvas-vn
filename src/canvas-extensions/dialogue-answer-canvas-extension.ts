import { Notice } from "obsidian"
import { Canvas, CanvasEdge, CanvasElement } from "src/@types/Canvas"
import {
  DialogueAnswerChecksData,
  DialogueAnswerConditionsData,
  DialogueAnswerData,
  DialogueAnswerEditorValue,
  DialogueEdgeData,
  DialogueFailureRouteData,
} from "src/@types/DialogueCanvas"
import CanvasHelper from "src/utils/canvas-helper"
import CanvasExtension from "./canvas-extension"
import EditDialogueAnswerModal from "src/modals/edit-dialogue-answer-modal"
import EditDialogueChecksModal from "src/modals/edit-dialogue-checks-modal"
import EditDialogueConditionsModal from "src/modals/edit-dialogue-conditions-modal"
import EditDialogueFailureRouteModal from "src/modals/edit-dialogue-failure-route-modal"
import DialogueStatsLoader from "src/utils/dialogue-stats-loader"
import DialoguePropertiesLoader from "src/utils/dialogue-properties-loader"

type CanvasEdgeDataWithDialogue = ReturnType<CanvasEdge["getData"]> & {
  id?: string
  label?: string
  fromNode?: string
  toNode?: string
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

    const edge = selectedEdges[0]!
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const isFailureRoute = edgeData["x-dialogue"]?.route?.type === "failure"

    if (!isFailureRoute) {
      CanvasHelper.addPopupMenuOption(
        canvas,
        CanvasHelper.createPopupMenuOption({
          id: "dialogue-canvas-edit-answer",
          icon: "message-square-text",
          label: "Edit Answer",
          callback: () => this.openEditAnswerModal(canvas, edge),
        })
      )

      CanvasHelper.addPopupMenuOption(
        canvas,
        CanvasHelper.createPopupMenuOption({
          id: "dialogue-canvas-edit-checks",
          icon: "dice-5",
          label: "Edit Checks",
          callback: () => this.openEditChecksModal(canvas, edge),
        })
      )

      CanvasHelper.addPopupMenuOption(
        canvas,
        CanvasHelper.createPopupMenuOption({
          id: "dialogue-canvas-edit-conditions",
          icon: "list-filter",
          label: "Edit Conditions",
          callback: () => this.openEditConditionsModal(canvas, edge),
        })
      )
    }

    CanvasHelper.addPopupMenuOption(
      canvas,
      CanvasHelper.createPopupMenuOption({
        id: "dialogue-canvas-edit-failure-route",
        icon: "circle-x",
        label: "Edit Failure Route",
        callback: () => this.openEditFailureRouteModal(canvas, edge),
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
    const answerMeta = edgeData["x-dialogue"]?.answer
    const visibleText = this.stripLabelPrefixes(edgeData.label ?? "")

    const initialValue: DialogueAnswerEditorValue = {
      answerId: answerMeta?.answerId ?? this.generateAnswerId(visibleText),
      text: visibleText,
      hideWhenUnavailable: answerMeta?.hideWhenUnavailable ?? true,
    }

    if (answerMeta?.checks !== undefined) {
      initialValue.checks = answerMeta.checks
    }

    if (answerMeta?.conditions !== undefined) {
      initialValue.conditions = answerMeta.conditions
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
    const answerMeta = edgeData["x-dialogue"]?.answer
    const stats = await DialogueStatsLoader.loadStats(this.plugin.app as any)

    const options: {
      stats: typeof stats
      initialValue?: DialogueAnswerChecksData
      onSubmit: (value: DialogueAnswerChecksData | undefined) => void
    } = {
      stats,
      onSubmit: value => {
        this.saveDialogueChecks(canvas, edge, value)
      },
    }

    if (answerMeta?.checks !== undefined) {
      options.initialValue = answerMeta.checks
    }

    new EditDialogueChecksModal(this.plugin.app as any, options).open()
  }

  private async openEditConditionsModal(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const answerMeta = edgeData["x-dialogue"]?.answer

    const [stats, properties] = await Promise.all([
      DialogueStatsLoader.loadStats(this.plugin.app as any),
      DialoguePropertiesLoader.loadProperties(this.plugin.app as any),
    ])

    const options: {
      stats: typeof stats
      properties: typeof properties
      initialValue?: DialogueAnswerConditionsData
      onSubmit: (value: DialogueAnswerConditionsData | undefined) => void
    } = {
      stats,
      properties,
      onSubmit: value => {
        this.saveDialogueConditions(canvas, edge, value)
      },
    }

    if (answerMeta?.conditions !== undefined) {
      options.initialValue = answerMeta.conditions
    }

    new EditDialogueConditionsModal(this.plugin.app as any, options).open()
  }

  private async openEditFailureRouteModal(canvas: Canvas, edge: CanvasEdge) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const routeMeta = edgeData["x-dialogue"]?.route

    const stats = await DialogueStatsLoader.loadStats(this.plugin.app as any)
    const answerIds = this.getAnswerIdsFromSameSourceNode(canvas, edge)

    const options: {
      answerIds: string[]
      stats: typeof stats
      initialValue?: DialogueFailureRouteData
      onSubmit: (value: DialogueFailureRouteData) => void
    } = {
      answerIds,
      stats,
      onSubmit: value => {
        this.saveFailureRoute(canvas, edge, value)
      },
    }

    if (routeMeta !== undefined) {
      options.initialValue = routeMeta
    }

    new EditDialogueFailureRouteModal(this.plugin.app as any, options).open()
  }

  private saveDialogueAnswer(
    canvas: Canvas,
    edge: CanvasEdge,
    editorValue: DialogueAnswerEditorValue
  ) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const existingAnswer = edgeData["x-dialogue"]?.answer

    const nextAnswer = this.createAnswerMeta({
      answerId: editorValue.answerId,
      hideWhenUnavailable: editorValue.hideWhenUnavailable ?? true,
      checks: existingAnswer?.checks ?? editorValue.checks,
      conditions: existingAnswer?.conditions ?? editorValue.conditions,
    })

    this.saveAnswerData(
      canvas,
      edge,
      nextAnswer,
      editorValue.text,
      "Dialogue Canvas: Answer saved"
    )
  }

  private saveDialogueChecks(
    canvas: Canvas,
    edge: CanvasEdge,
    checks: DialogueAnswerChecksData | undefined
  ) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const existingAnswer = edgeData["x-dialogue"]?.answer
    const visibleText = this.stripLabelPrefixes(edgeData.label ?? "")

    const nextAnswer = this.createAnswerMeta({
      answerId: existingAnswer?.answerId ?? this.generateAnswerId(visibleText),
      hideWhenUnavailable: existingAnswer?.hideWhenUnavailable ?? true,
      checks,
      conditions: existingAnswer?.conditions,
    })

    this.saveAnswerData(
      canvas,
      edge,
      nextAnswer,
      visibleText,
      "Dialogue Canvas: Checks saved"
    )
  }

  private saveDialogueConditions(
    canvas: Canvas,
    edge: CanvasEdge,
    conditions: DialogueAnswerConditionsData | undefined
  ) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const existingAnswer = edgeData["x-dialogue"]?.answer
    const visibleText = this.stripLabelPrefixes(edgeData.label ?? "")

    const nextAnswer = this.createAnswerMeta({
      answerId: existingAnswer?.answerId ?? this.generateAnswerId(visibleText),
      hideWhenUnavailable: existingAnswer?.hideWhenUnavailable ?? true,
      checks: existingAnswer?.checks,
      conditions,
    })

    this.saveAnswerData(
      canvas,
      edge,
      nextAnswer,
      visibleText,
      "Dialogue Canvas: Conditions saved"
    )
  }

  private createAnswerMeta(value: {
    answerId: string
    hideWhenUnavailable: boolean
    checks?: DialogueAnswerChecksData
    conditions?: DialogueAnswerConditionsData
  }): DialogueAnswerData {
    const answer: DialogueAnswerData = {
      answerId: value.answerId,
      hideWhenUnavailable: value.hideWhenUnavailable,
    }

    if (value.checks !== undefined) {
      answer.checks = value.checks
    }

    if (value.conditions !== undefined) {
      answer.conditions = value.conditions
    }

    return answer
  }

  private saveAnswerData(
    canvas: Canvas,
    edge: CanvasEdge,
    answerMeta: DialogueAnswerData,
    visibleText: string,
    notice: string
  ) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue
    const cleanVisibleText = this.stripLabelPrefixes(visibleText)

    const nextXDialogue: DialogueEdgeData = {
      ...edgeData["x-dialogue"],
      answer: answerMeta,
    }

    delete nextXDialogue.route

    const nextData: CanvasEdgeDataWithDialogue = {
      ...edgeData,
      label: this.buildEdgeLabel(answerMeta, cleanVisibleText),
      "x-dialogue": nextXDialogue,
    }

    edge.setData(nextData)
    canvas.pushHistory(canvas.getData())

    new Notice(notice)
    console.log("[Dialogue Canvas] Saved answer data", nextData)
  }

  private saveFailureRoute(
    canvas: Canvas,
    edge: CanvasEdge,
    routeMeta: DialogueFailureRouteData
  ) {
    const edgeData = edge.getData() as CanvasEdgeDataWithDialogue

    const nextXDialogue: DialogueEdgeData = {
      ...edgeData["x-dialogue"],
      route: routeMeta,
    }

    delete nextXDialogue.answer

    const nextData: CanvasEdgeDataWithDialogue = {
      ...edgeData,
      label: this.buildFailureRouteLabel(routeMeta),
      "x-dialogue": nextXDialogue,
    }

    edge.setData(nextData)
    canvas.pushHistory(canvas.getData())

    new Notice("Dialogue Canvas: Failure route saved")
    console.log("[Dialogue Canvas] Saved failure route", nextData)
  }

  private getAnswerIdsFromSameSourceNode(canvas: Canvas, selectedEdge: CanvasEdge): string[] {
    const selectedEdgeData = selectedEdge.getData() as CanvasEdgeDataWithDialogue
    const sourceNodeId = selectedEdgeData.fromNode

    if (!sourceNodeId) {
      return []
    }

    const result: string[] = []
    const edges = this.getCanvasEdges(canvas)

    for (const edge of edges) {
      if (edge === selectedEdge) {
        continue
      }

      const edgeData = edge.getData() as CanvasEdgeDataWithDialogue

      if (edgeData.fromNode !== sourceNodeId) {
        continue
      }

      const answerId = edgeData["x-dialogue"]?.answer?.answerId

      if (!answerId || result.includes(answerId)) {
        continue
      }

      result.push(answerId)
    }

    return result
  }

  private getCanvasEdges(canvas: Canvas): CanvasEdge[] {
    const edgesMap = (canvas as any).edges

    if (!edgesMap?.values) {
      return []
    }

    return [...edgesMap.values()] as CanvasEdge[]
  }

  private buildEdgeLabel(answerMeta: DialogueAnswerData, visibleText: string): string {
    const cleanVisibleText = this.stripLabelPrefixes(visibleText)

    const hasChecks = (answerMeta.checks?.items?.length ?? 0) > 0
    const hasConditions = (answerMeta.conditions?.items?.length ?? 0) > 0

    const prefixes: string[] = []

    if (hasChecks) {
      prefixes.push("🎲")
    }

    if (hasConditions) {
      prefixes.push("🔒")
    }

    return prefixes.length > 0
      ? `${prefixes.join(" ")} ${cleanVisibleText}`
      : cleanVisibleText
  }

  private buildFailureRouteLabel(routeMeta: DialogueFailureRouteData): string {
    if (routeMeta.statId) {
      return `❌ ${routeMeta.answerId} / ${routeMeta.statId}`
    }

    return `❌ ${routeMeta.answerId}`
  }

  private stripLabelPrefixes(label: string): string {
    return label.replace(/^((🎲|🔒|❌)\s*)+/u, "").trim()
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