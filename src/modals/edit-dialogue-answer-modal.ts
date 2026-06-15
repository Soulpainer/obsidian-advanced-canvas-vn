import { ButtonComponent, Modal, Notice, Setting } from "obsidian"
import { DialogueAnswerEditorValue } from "src/@types/DialogueCanvas"

export interface EditDialogueAnswerModalOptions {
  initialValue: DialogueAnswerEditorValue
  onSubmit: (value: DialogueAnswerEditorValue) => void
}

export default class EditDialogueAnswerModal extends Modal {
  private value: DialogueAnswerEditorValue
  private readonly onSubmitCallback: (value: DialogueAnswerEditorValue) => void

  constructor(app: any, options: EditDialogueAnswerModalOptions) {
    super(app)

    this.value = {
      answerId: options.initialValue.answerId ?? "",
      text: options.initialValue.text ?? "",
      hideWhenUnavailable: options.initialValue.hideWhenUnavailable ?? true,
      checks: options.initialValue.checks,
    }

    this.onSubmitCallback = options.onSubmit
  }

  onOpen() {
    const { contentEl } = this

    contentEl.empty()
    contentEl.createEl("h2", { text: "Edit Dialogue Answer" })

    new Setting(contentEl)
      .setName("Answer ID")
      .setDesc("Stable ID for this answer inside the source frame.")
      .addText(text => {
        text
          .setPlaceholder("try_remember")
          .setValue(this.value.answerId)
          .onChange(value => {
            this.value.answerId = value.trim()
          })
      })

    new Setting(contentEl)
      .setName("Answer text")
      .setDesc("This will also be written to the canvas edge label.")
      .addText(text => {
        text
          .setPlaceholder("Попытаться вспомнить")
          .setValue(this.value.text)
          .onChange(value => {
            this.value.text = value
          })
      })

    new Setting(contentEl)
      .setName("Hide when unavailable")
      .setDesc("Later this will control conditional answer visibility.")
      .addToggle(toggle => {
        toggle
          .setValue(this.value.hideWhenUnavailable ?? true)
          .onChange(value => {
            this.value.hideWhenUnavailable = value
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
            if (!this.value.answerId) {
              new Notice("Dialogue Canvas: Answer ID is empty")
              return
            }

            if (!this.value.text) {
              new Notice("Dialogue Canvas: Answer text is empty")
              return
            }

            this.onSubmitCallback({
              answerId: this.value.answerId,
              text: this.value.text,
              hideWhenUnavailable: this.value.hideWhenUnavailable ?? true,
              checks: this.value.checks,
            })

            this.close()
          })
      })
  }

  onClose() {
    this.contentEl.empty()
  }
}
