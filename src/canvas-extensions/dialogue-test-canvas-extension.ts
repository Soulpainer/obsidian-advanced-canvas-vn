import { Notice, setTooltip } from "obsidian"
import { Canvas, CanvasEdge, CanvasElement } from "src/@types/Canvas"
import CanvasExtension from "./canvas-extension"

export default class DialogueTestCanvasExtension extends CanvasExtension {
  isEnabled() {
    return true
  }

  init() {
    console.log("[Dialogue Canvas] DialogueTestCanvasExtension init")

    this.plugin.registerEvent(
      this.plugin.app.workspace.on(
        "advanced-canvas:popup-menu-created",
        (canvas: Canvas) => this.onPopupMenuCreated(canvas)
      )
    )
  }

  private onPopupMenuCreated(canvas: Canvas) {
    const popupMenuEl = canvas?.menu?.menuEl

    console.log("[Dialogue Canvas] popup menu created", {
      popupMenuEl,
      selection: [...canvas.selection],
      selectionData: canvas.getSelectionData?.()
    })

    if (!popupMenuEl) return

    const selectedEdges = [...canvas.selection].filter((item: CanvasElement) =>
      (item as CanvasEdge).path !== undefined
    ) as CanvasEdge[]

    const selectionData = canvas.getSelectionData?.() as any
    const hasSelectedEdge =
      selectedEdges.length > 0 ||
      (selectionData?.edges?.length ?? 0) > 0

    if (!hasSelectedEdge) return

    popupMenuEl.querySelector("#dialogue-canvas-test-button")?.remove()

    const testButton = activeDocument.createElement("button")
    testButton.id = "dialogue-canvas-test-button"
    testButton.classList.add("clickable-icon")
    testButton.textContent = "Test"
    testButton.style.width = "auto"
    testButton.style.padding = "0 8px"

    setTooltip(testButton, "Dialogue Canvas Test", {
      placement: "top"
    })

    testButton.addEventListener("click", () => {
      console.log("[Dialogue Canvas] Test clicked", {
        selectedEdges,
        selectionData: canvas.getSelectionData?.()
      })

      new Notice("Dialogue Canvas: Test")
    })

    popupMenuEl.appendChild(testButton)
  }
}