import { ButtonComponent, Modal, Notice, Setting } from "obsidian"
import {
  DialogueCharacterDefinition,
  DialogueFrameData,
} from "src/@types/DialogueCanvas"

export interface EditDialogueFrameModalOptions {
  initialValue: DialogueFrameData
  characters: DialogueCharacterDefinition[]
  onSubmit: (value: DialogueFrameData) => void
}

export default class EditDialogueFrameModal extends Modal {
  private value: DialogueFrameData
  private readonly characters: DialogueCharacterDefinition[]
  private readonly onSubmitCallback: (value: DialogueFrameData) => void

  constructor(app: any, options: EditDialogueFrameModalOptions) {
    super(app)

    this.value = {
      frameId: options.initialValue.frameId ?? "",
      speakerId: options.initialValue.speakerId ?? "",
      text: options.initialValue.text ?? "",
    }

    this.characters = options.characters
    this.onSubmitCallback = options.onSubmit
  }

  onOpen() {
    const { contentEl } = this

    contentEl.empty()
    contentEl.createEl("h2", { text: "Edit Dialogue Frame" })

    new Setting(contentEl)
      .setName("Frame ID")
      .setDesc("Stable ID of this dialogue frame.")
      .addText(text => {
        text
          .setPlaceholder("start")
          .setValue(this.value.frameId)
          .onChange(value => {
            this.value.frameId = value.trim()
          })
      })

    new Setting(contentEl)
      .setName("Speaker")
      .setDesc("Character shown near this canvas card.")
      .addDropdown(dropdown => {
        dropdown.addOption("", "None")

        for (const character of this.characters) {
          dropdown.addOption(character.id, `${character.name} (${character.id})`)
        }

        dropdown
          .setValue(this.value.speakerId ?? "")
          .onChange(value => {
            this.value.speakerId = value || undefined
          })
      })

    const textContainer = contentEl.createDiv()
    textContainer.addClass("dialogue-canvas-modal-textarea-container")

    textContainer.createEl("label", {
      text: "Frame text",
      cls: "dialogue-canvas-modal-label",
    })

    const textarea = textContainer.createEl("textarea")
    textarea.addClass("dialogue-canvas-modal-textarea")
    textarea.placeholder = "Ты снова очнулся в кресле пилота."
    textarea.value = this.value.text
    textarea.addEventListener("input", () => {
      this.value.text = textarea.value
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
            if (!this.value.frameId) {
              new Notice("Dialogue Canvas: Frame ID is empty")
              return
            }

            this.onSubmitCallback({
              frameId: this.value.frameId,
              speakerId: this.value.speakerId || undefined,
              text: this.value.text ?? "",
            })

            this.close()
          })
      })
  }

  onClose() {
    this.contentEl.empty()
  }
}