import { ButtonComponent, Modal, Notice, Setting } from "obsidian"
import {
  DialogueCharacterDefinition,
  DialogueChoiceData,
  DialogueFrameEditorValue,
  DialoguePropertyDefinition,
  DialogueStatDefinition,
} from "src/@types/DialogueCanvas"
import EditDialogueChecksModal from "./edit-dialogue-checks-modal"
import EditDialogueConditionsModal from "./edit-dialogue-conditions-modal"

export interface EditDialogueFrameModalOptions {
  initialValue: DialogueFrameEditorValue
  characters: DialogueCharacterDefinition[]
  stats: DialogueStatDefinition[]
  properties: DialoguePropertyDefinition[]
  focusTarget?: DialogueFrameFocusTarget
  onSubmit: (value: DialogueFrameEditorValue) => void
  onClose?: () => void
}

export type DialogueFrameFocusTarget =
  | { type: "frameText" }
  | { type: "choiceText", choiceId: string }

export default class EditDialogueFrameModal extends Modal {
  private value: DialogueFrameEditorValue
  private readonly characters: DialogueCharacterDefinition[]
  private readonly stats: DialogueStatDefinition[]
  private readonly properties: DialoguePropertyDefinition[]
  private readonly onSubmitCallback: (value: DialogueFrameEditorValue) => void
  private readonly onCloseCallback?: () => void
  private pendingFocusTarget?: DialogueFrameFocusTarget

  constructor(app: any, options: EditDialogueFrameModalOptions) {
    super(app)

    this.value = {
      frameId: options.initialValue.frameId ?? "",
      speakerId: options.initialValue.speakerId,
      text: options.initialValue.text ?? "",
      choices: options.initialValue.choices?.map(choice => ({ ...choice })) ?? [],
    }

    this.characters = options.characters
    this.stats = options.stats
    this.properties = options.properties
    this.onSubmitCallback = options.onSubmit
    this.onCloseCallback = options.onClose
    this.pendingFocusTarget = options.focusTarget
  }

  onOpen() {
    this.render()
  }

  private render() {
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
    this.focusTextareaIfRequested(textarea, { type: "frameText" })

    this.renderChoicesSection(contentEl)

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
              choices: this.getValidChoices(),
            })

            this.close()
          })
      })
  }

  onClose() {
    this.contentEl.empty()
    this.onCloseCallback?.()
  }

  // LLM agent change: choices are edited in the frame modal because they belong to the frame node.
  private renderChoicesSection(contentEl: HTMLElement) {
    contentEl.createEl("h3", { text: "Choices" })

    const choices = this.value.choices ?? []

    if (choices.length === 0) {
      contentEl.createEl("p", {
        text: "No choices yet.",
      })
    }

    choices.forEach((choice, index) => {
      const container = contentEl.createDiv()
      container.addClass("dialogue-canvas-choice-editor-row")
      container.style.setProperty("--dialogue-choice-success-color", this.getChoiceSuccessColor(index))
      container.style.setProperty("--dialogue-choice-failure-color", this.getChoiceFailureColor(index))

      new Setting(container)
        .setName(`Choice ${index + 1}`)
        .setDesc(this.getChoiceSettingsDescription(choice, index))
        .addButton(button => {
          button
            .setButtonText("Checks")
            .onClick(() => {
              this.openChoiceChecksModal(choice)
            })
        })
        .addButton(button => {
          button
            .setButtonText("Conditions")
            .onClick(() => {
              this.openChoiceConditionsModal(choice)
            })
        })
        .addButton(button => {
          button
            .setButtonText("Remove")
            .onClick(() => {
              choices.splice(index, 1)
              this.render()
            })
        })

      const textContainer = container.createDiv()
      textContainer.addClass("dialogue-canvas-choice-textarea-container")

      textContainer.createEl("label", {
        text: "Choice text",
        cls: "dialogue-canvas-modal-label",
      })

      const textarea = textContainer.createEl("textarea")
      textarea.addClass("dialogue-canvas-choice-textarea")
      textarea.placeholder = "Ask about the ship"
      textarea.value = choice.text
      textarea.addEventListener("input", () => {
        choice.text = textarea.value
      })
      this.focusTextareaIfRequested(textarea, { type: "choiceText", choiceId: choice.choiceId })

      new Setting(container)
        .setName("Hide when unavailable")
        .setDesc("Kept with this choice for later checks and conditions.")
        .addToggle(toggle => {
          toggle
            .setValue(choice.hideWhenUnavailable ?? true)
            .onChange(value => {
              choice.hideWhenUnavailable = value
            })
        })

      if (this.choiceHasFailureSlot(choice)) {
        const failureEl = container.createDiv()
        failureEl.addClass("dialogue-canvas-choice-editor-failure")
        failureEl.textContent = "Failure slot"
      }
    })

    new Setting(contentEl)
      .addButton(button => {
        button
          .setButtonText("Add Choice")
          .onClick(() => {
            choices.push(this.createChoice())
            this.value.choices = choices
            this.render()
          })
      })
  }

  private createChoice(): DialogueChoiceData {
    return {
      choiceId: String((this.value.choices ?? []).length + 1),
      text: "Choice",
      hideWhenUnavailable: true,
    }
  }

  private getValidChoices(): DialogueChoiceData[] {
    const result: DialogueChoiceData[] = []

    for (const choice of this.value.choices ?? []) {
      const text = choice.text.trim()

      if (!text) {
        continue
      }

      result.push({
        ...choice,
        choiceId: String(result.length + 1),
        text,
        hideWhenUnavailable: choice.hideWhenUnavailable ?? true,
      })
    }

    return result
  }

  private openChoiceChecksModal(choice: DialogueChoiceData) {
    new EditDialogueChecksModal(this.app as any, {
      stats: this.stats,
      initialValue: choice.checks,
      onSubmit: value => {
        choice.checks = value
        this.render()
      },
    }).open()
  }

  private openChoiceConditionsModal(choice: DialogueChoiceData) {
    new EditDialogueConditionsModal(this.app as any, {
      stats: this.stats,
      properties: this.properties,
      initialValue: choice.conditions,
      onSubmit: value => {
        choice.conditions = value
        this.render()
      },
    }).open()
  }

  private focusTextareaIfRequested(textarea: HTMLTextAreaElement, target: DialogueFrameFocusTarget) {
    if (!this.isFocusTargetMatch(target)) {
      return
    }

    const focusTarget = this.pendingFocusTarget
    this.pendingFocusTarget = undefined

    window.requestAnimationFrame(() => {
      // LLM agent change: double-clicking a dialogue row opens the modal directly on the relevant text field.
      textarea.focus()
      textarea.select()
      textarea.scrollIntoView({ block: "center" })
    })
  }

  private isFocusTargetMatch(target: DialogueFrameFocusTarget): boolean {
    const pending = this.pendingFocusTarget

    if (!pending || pending.type !== target.type) {
      return false
    }

    if (pending.type === "choiceText" && target.type === "choiceText") {
      return pending.choiceId === target.choiceId
    }

    return pending.type === "frameText"
  }

  private getChoiceSettingsDescription(choice: DialogueChoiceData, index: number): string {
    const checksCount = choice.checks?.items?.length ?? 0
    const conditionsCount = choice.conditions?.items?.length ?? 0

    return `Internal route ID: ${index + 1}. Checks: ${checksCount}. Conditions: ${conditionsCount}.`
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
    return this.getChoiceSuccessColor(index)
  }

  private generateChoiceId(label: string): string {
    const normalized = label
      .toLowerCase()
      .trim()
      .replace(/<[^>]*>/g, "")
      .replace(/[^a-zа-яё0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")

    return normalized || "choice"
  }

  private generateStableChoiceId(): string {
    const choices = this.value.choices ?? []
    const existingIds = new Set(choices.map(choice => choice.choiceId))

    let index = choices.length + 1
    let choiceId = this.generateChoiceId(`choice_${index}`)

    while (existingIds.has(choiceId)) {
      index += 1
      choiceId = this.generateChoiceId(`choice_${index}`)
    }

    return choiceId
  }
}
