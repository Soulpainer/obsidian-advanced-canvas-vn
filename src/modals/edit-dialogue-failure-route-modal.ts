import { ButtonComponent, Modal, Notice, Setting } from "obsidian"
import {
  DialogueFailureRouteData,
  DialogueStatDefinition,
} from "src/@types/DialogueCanvas"

export interface EditDialogueFailureRouteModalOptions {
  initialValue?: DialogueFailureRouteData
  answerIds: string[]
  stats: DialogueStatDefinition[]
  onSubmit: (value: DialogueFailureRouteData) => void
}

export default class EditDialogueFailureRouteModal extends Modal {
  private answerId: string
  private statId: string

  private readonly answerIds: string[]
  private readonly stats: DialogueStatDefinition[]
  private readonly onSubmitCallback: (value: DialogueFailureRouteData) => void

  constructor(app: any, options: EditDialogueFailureRouteModalOptions) {
    super(app)

    this.answerIds = options.answerIds
    this.stats = options.stats

    this.answerId =
      options.initialValue?.answerId ??
      options.answerIds[0] ??
      ""

    this.statId = options.initialValue?.statId ?? ""

    this.onSubmitCallback = options.onSubmit
  }

  onOpen() {
    const { contentEl } = this

    contentEl.empty()
    contentEl.createEl("h2", { text: "Edit Failure Route" })

    if (this.answerIds.length > 0) {
      new Setting(contentEl)
        .setName("Answer")
        .setDesc("Failure route belongs to this answerId.")
        .addDropdown(dropdown => {
          for (const answerId of this.answerIds) {
            dropdown.addOption(answerId, answerId)
          }

          dropdown
            .setValue(this.answerId)
            .onChange(value => {
              this.answerId = value
            })
        })
    } else {
      new Setting(contentEl)
        .setName("Answer ID")
        .setDesc("No answer edges found from this source node. Enter answerId manually.")
        .addText(text => {
          text
            .setPlaceholder("try_remember")
            .setValue(this.answerId)
            .onChange(value => {
              this.answerId = value.trim()
            })
        })
    }

    new Setting(contentEl)
      .setName("Failed stat")
      .setDesc("Optional. Empty means fallback for any failed stat.")
      .addDropdown(dropdown => {
        dropdown.addOption("", "Any failed stat")

        for (const stat of this.stats) {
          dropdown.addOption(stat.id, `${stat.name} (${stat.id})`)
        }

        dropdown
          .setValue(this.statId)
          .onChange(value => {
            this.statId = value
          })
      })

    new Setting(contentEl)
      .addButton((button: ButtonComponent) => {
        button
          .setButtonText("Cancel")
          .onClick(() => {
            this.close()
          })
      })
      .addButton((button: ButtonComponent) => {
        button
          .setCta()
          .setButtonText("Save")
          .onClick(() => {
            if (!this.answerId) {
              new Notice("Dialogue Canvas: Answer ID is empty")
              return
            }

            const route: DialogueFailureRouteData = {
              type: "failure",
              answerId: this.answerId,
            }

            if (this.statId) {
              route.statId = this.statId
            }

            this.onSubmitCallback(route)
            this.close()
          })
      })
  }

  onClose() {
    this.contentEl.empty()
  }
}