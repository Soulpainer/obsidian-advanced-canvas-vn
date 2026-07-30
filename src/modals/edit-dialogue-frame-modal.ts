import { ButtonComponent, Modal, Notice, Setting } from "obsidian"
import {
  DialogueCharacterDefinition,
  DialogueChoiceData,
  DialogueFrameActionData,
  DialogueFrameActionNumericValue,
  DialogueFrameActionOperation,
  DialogueFrameActionType,
  DialogueFrameActionValue,
  DialogueFrameEditorValue,
  DialoguePropertyDefinition,
  DialogueStatDefinition,
  DialogueTriggerDefinition,
} from "src/@types/DialogueCanvas"
import EditDialogueChecksModal from "./edit-dialogue-checks-modal"
import EditDialogueConditionsModal from "./edit-dialogue-conditions-modal"

export interface EditDialogueFrameModalOptions {
  initialValue: DialogueFrameEditorValue
  characters: DialogueCharacterDefinition[]
  stats: DialogueStatDefinition[]
  properties: DialoguePropertyDefinition[]
  triggers: DialogueTriggerDefinition[]
  focusTarget?: DialogueFrameFocusTarget
  onSubmit: (value: DialogueFrameEditorValue) => void
  // LLM agent change: called with wasSubmitted so the caller can clean up a freshly-spawned node
  // when the user cancelled instead of saving.
  onClose?: (wasSubmitted: boolean) => void
}

export type DialogueFrameFocusTarget =
  | { type: "frameText" }
  | { type: "choiceText", choiceId: string }

export default class EditDialogueFrameModal extends Modal {
  private value: DialogueFrameEditorValue
  private readonly characters: DialogueCharacterDefinition[]
  private readonly stats: DialogueStatDefinition[]
  private readonly properties: DialoguePropertyDefinition[]
  private readonly triggers: DialogueTriggerDefinition[]
  private readonly onSubmitCallback: (value: DialogueFrameEditorValue) => void
  private readonly onCloseCallback?: (wasSubmitted: boolean) => void
  private pendingFocusTarget?: DialogueFrameFocusTarget
  private readonly collapsedChoiceIds = new Set<string>()
  private readonly collapsedActionIndexes = new Set<number>()

  constructor(app: any, options: EditDialogueFrameModalOptions) {
    super(app)

    this.value = {
      frameId: options.initialValue.frameId ?? "",
      speakerId: options.initialValue.speakerId,
      text: options.initialValue.text ?? "",
      choices: options.initialValue.choices?.map(choice => ({ ...choice })) ?? [],
      actions: options.initialValue.actions?.map(action => ({ ...action })) ?? [],
    }

    this.characters = options.characters
    this.stats = options.stats
    this.properties = options.properties
    this.triggers = options.triggers
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
    this.renderActionsSection(contentEl)

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
              actions: this.getValidActions(),
            })

            // LLM agent change: mark submitted before close so onClose knows this wasn't a cancel.
            this.wasSubmitted = true
            this.close()
          })
      })
  }

  onClose() {
    this.contentEl.empty()
    // LLM agent change: pass whether the user submitted (Save) vs cancelled, so the caller can
    // clean up a freshly-spawned node on cancel.
    this.onCloseCallback?.(this.wasSubmitted)
  }

  // LLM agent change: set to true right before close() in the Save path, so onClose can tell a
  // cancel from a submit.
  private wasSubmitted = false

  // LLM agent change: frame actions describe side effects that happen when this dialogue frame is entered.
  private renderActionsSection(contentEl: HTMLElement) {
    const actions = this.value.actions ?? []
    const allCollapsed = actions.length > 0 && actions.every((_action, index) => this.collapsedActionIndexes.has(index))

    this.renderSectionHeader(contentEl, "Actions", allCollapsed ? "Expand all" : "Collapse all", () => {
      if (allCollapsed) {
        this.collapsedActionIndexes.clear()
      } else {
        actions.forEach((_action, index) => this.collapsedActionIndexes.add(index))
      }

      this.render()
    })

    if (actions.length === 0) {
      contentEl.createEl("p", {
        text: "No actions yet.",
      })
    }

    actions.forEach((action, index) => {
      const container = contentEl.createDiv()
      container.addClass("dialogue-canvas-action-editor-row")
      const isCollapsed = this.collapsedActionIndexes.has(index)

      new Setting(container)
        .setName(`Action ${index + 1}`)
        .setDesc(this.getActionDescription(action))
        .addButton(button => {
          button
            .setButtonText(isCollapsed ? "Expand" : "Collapse")
            .onClick(() => {
              if (isCollapsed) {
                this.collapsedActionIndexes.delete(index)
              } else {
                this.collapsedActionIndexes.add(index)
              }

              this.render()
            })
        })
        .addDropdown(dropdown => {
          dropdown.addOption("trigger", "Trigger")
          dropdown.addOption("globalProperty", "Global property")
          dropdown.addOption("characterStat", "Character stat")
          dropdown.addOption("characterInventory", "Character inventory")
          dropdown
            .setValue(action.type)
            .onChange(value => {
              actions[index] = this.createAction(value as DialogueFrameActionType)
              this.render()
            })
        })
        .addButton(button => {
          button
            .setButtonText("Remove")
            .onClick(() => {
              actions.splice(index, 1)
              this.collapsedActionIndexes.delete(index)
              this.render()
            })
        })

      if (isCollapsed) {
        return
      }

      this.renderActionFields(container, action)
    })

    new Setting(contentEl)
      .addButton(button => {
        button
          .setButtonText("Add Action")
          .onClick(() => {
            actions.push(this.createAction("trigger"))
            this.value.actions = actions
            this.render()
          })
      })
  }

  private renderActionFields(container: HTMLElement, action: DialogueFrameActionData) {
    if (action.type === "trigger") {
      new Setting(container)
        .setName("Trigger")
        .addDropdown(dropdown => {
          for (const trigger of this.triggers) {
            dropdown.addOption(trigger.id, `${trigger.name} (${trigger.id})`)
          }

          if (this.triggers.length === 0) {
            dropdown.addOption(action.triggerId, action.triggerId || "No triggers loaded")
          }

          dropdown
            .setValue(action.triggerId)
            .onChange(value => {
              action.triggerId = value
            })
        })
      return
    }

    if (action.type === "globalProperty") {
      new Setting(container)
        .setName("Property")
        .addDropdown(dropdown => {
          for (const property of this.properties) {
            dropdown.addOption(property.id, `${property.name} (${property.id})`)
          }

          if (this.properties.length === 0) {
            dropdown.addOption(action.propertyId, action.propertyId || "No properties loaded")
          }

          dropdown
            .setValue(action.propertyId)
            .onChange(value => {
              action.propertyId = value
            })
        })

      this.renderOperationFields(container, action)
      return
    }

    new Setting(container)
      .setName("Character")
      .addDropdown(dropdown => {
        for (const character of this.characters) {
          dropdown.addOption(character.id, `${character.name} (${character.id})`)
        }

        if (this.characters.length === 0) {
          dropdown.addOption(action.characterId, action.characterId || "No characters loaded")
        }

        dropdown
          .setValue(action.characterId)
          .onChange(value => {
            action.characterId = value
          })
      })

    if (action.type === "characterStat") {
      new Setting(container)
        .setName("Stat")
        .addDropdown(dropdown => {
          for (const stat of this.stats) {
            dropdown.addOption(stat.id, `${stat.name} (${stat.id})`)
          }

          if (this.stats.length === 0) {
            dropdown.addOption(action.statId, action.statId || "No stats loaded")
          }

          dropdown
            .setValue(action.statId)
            .onChange(value => {
              action.statId = value
            })
        })

      this.renderOperationFields(container, action)
      return
    }

    new Setting(container)
      .setName("Item ID")
      .addText(text => {
        text
          .setPlaceholder("medkit")
          .setValue(action.itemId)
          .onChange(value => {
            action.itemId = value.trim()
          })
      })

    this.renderOperationFields(container, action)
  }

  private renderOperationFields(
    container: HTMLElement,
    action: Extract<DialogueFrameActionData, { operation: DialogueFrameActionOperation }>
  ) {
    new Setting(container)
      .setName("Operation")
      .addDropdown(dropdown => {
        dropdown.addOption("add", "+ add")
        dropdown.addOption("subtract", "- subtract")
        dropdown.addOption("set", "= set")
        dropdown
          .setValue(action.operation)
          .onChange(value => {
            action.operation = value as DialogueFrameActionOperation
          })
      })

    this.renderActionValueFields(container, action)
  }

  private renderActionValueFields(
    container: HTMLElement,
    action: Extract<DialogueFrameActionData, { operation: DialogueFrameActionOperation }>
  ) {
    const currentValue = this.getActionValue(action)
    const isRange = this.isRangeValue(currentValue)

    new Setting(container)
      .setName("Value mode")
      .addDropdown(dropdown => {
        dropdown.addOption("fixed", "Fixed")
        dropdown.addOption("range", "Random range")
        dropdown
          .setValue(isRange ? "range" : "fixed")
          .onChange(value => {
            if (value === "range") {
              this.setActionValue(action, this.createRangeValue(currentValue))
            } else {
              this.setActionValue(action, this.getFixedValueFromActionValue(currentValue))
            }

            this.render()
          })
      })

    if (isRange) {
      new Setting(container)
        .setName("Random range")
        .addText(text => {
          text
            .setPlaceholder("min")
            .setValue(String(currentValue.min))
            .onChange(value => {
              currentValue.min = this.parseNumber(value, currentValue.min)
            })
        })
        .addText(text => {
          text
            .setPlaceholder("max")
            .setValue(String(currentValue.max))
            .onChange(value => {
              currentValue.max = this.parseNumber(value, currentValue.max)
            })
        })
        .addDropdown(dropdown => {
          dropdown.addOption("integer", "Integer")
          dropdown.addOption("float", "Float")
          dropdown
            .setValue(currentValue.numberType)
            .onChange(value => {
              currentValue.numberType = value === "float" ? "float" : "integer"
            })
        })
      return
    }

    new Setting(container)
      .setName("Value")
      .addText(text => {
        text
          .setPlaceholder("1")
          .setValue(String(currentValue))
          .onChange(value => {
            const parsedNumber = Number(value)
            this.setActionValue(action, Number.isNaN(parsedNumber) ? value : parsedNumber)
          })
      })
  }

  // LLM agent change: choices are edited in the frame modal because they belong to the frame node.
  private renderChoicesSection(contentEl: HTMLElement) {
    const choices = this.value.choices ?? []
    const allCollapsed = choices.length > 0 && choices.every(choice => this.collapsedChoiceIds.has(choice.choiceId))

    this.renderSectionHeader(contentEl, "Choices", allCollapsed ? "Expand all" : "Collapse all", () => {
      if (allCollapsed) {
        this.collapsedChoiceIds.clear()
      } else {
        choices.forEach(choice => this.collapsedChoiceIds.add(choice.choiceId))
      }

      this.render()
    })

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
      const isCollapsed = this.collapsedChoiceIds.has(choice.choiceId) && !this.isPendingChoiceFocus(choice.choiceId)

      new Setting(container)
        .setName(`Choice ${index + 1}`)
        .setDesc(this.getChoiceSettingsDescription(choice, index))
        .addButton(button => {
          button
            .setButtonText(isCollapsed ? "Expand" : "Collapse")
            .onClick(() => {
              if (isCollapsed) {
                this.collapsedChoiceIds.delete(choice.choiceId)
              } else {
                this.collapsedChoiceIds.add(choice.choiceId)
              }

              this.render()
            })
        })
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
              this.collapsedChoiceIds.delete(choice.choiceId)
              this.render()
            })
        })

      if (isCollapsed) {
        return
      }

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

  private renderSectionHeader(contentEl: HTMLElement, title: string, buttonText: string, onClick: () => void) {
    const headerEl = contentEl.createDiv()
    headerEl.addClass("dialogue-canvas-editor-section-header")

    headerEl.createEl("h3", { text: title })

    new ButtonComponent(headerEl)
      .setButtonText(buttonText)
      .onClick(onClick)
  }

  private createAction(type: DialogueFrameActionType): DialogueFrameActionData {
    if (type === "globalProperty") {
      return {
        type,
        propertyId: this.properties[0]?.id ?? "",
        operation: "set",
        value: this.properties[0]?.type === "bool" ? true : 0,
      }
    }

    if (type === "characterStat") {
      return {
        type,
        characterId: this.characters[0]?.id ?? "",
        statId: this.stats[0]?.id ?? "",
        operation: "add",
        value: 1,
      }
    }

    if (type === "characterInventory") {
      return {
        type,
        characterId: this.characters[0]?.id ?? "",
        itemId: "",
        operation: "add",
        quantity: 1,
      }
    }

    return {
      type: "trigger",
      triggerId: this.triggers[0]?.id ?? "",
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

  private getValidActions(): DialogueFrameActionData[] {
    return (this.value.actions ?? []).filter(action => {
      if (action.type === "trigger") {
        return Boolean(action.triggerId)
      }

      if (action.type === "globalProperty") {
        return Boolean(action.propertyId)
      }

      if (action.type === "characterStat") {
        return Boolean(action.characterId && action.statId)
      }

      return Boolean(action.characterId && action.itemId)
    })
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

  private isPendingChoiceFocus(choiceId: string): boolean {
    return this.pendingFocusTarget?.type === "choiceText" && this.pendingFocusTarget.choiceId === choiceId
  }

  private getChoiceSettingsDescription(choice: DialogueChoiceData, index: number): string {
    const checksCount = choice.checks?.items?.length ?? 0
    const conditionsCount = choice.conditions?.items?.length ?? 0

    return `Internal route ID: ${index + 1}. Checks: ${checksCount}. Conditions: ${conditionsCount}.`
  }

  private getActionDescription(action: DialogueFrameActionData): string {
    if (action.type === "trigger") {
      const trigger = this.triggers.find(item => item.id === action.triggerId)
      return trigger?.description || "Call a named trigger."
    }

    const valueText = this.formatActionValue(this.getActionValue(action))

    if (action.type === "globalProperty") {
      return `${action.operation} global ${action.propertyId} ${valueText}`
    }

    if (action.type === "characterStat") {
      return `${action.operation} ${action.characterId}.${action.statId} ${valueText}`
    }

    return `${action.operation} ${action.characterId}.inventory.${action.itemId || "item"} ${valueText}`
  }

  private getActionValue(
    action: Extract<DialogueFrameActionData, { operation: DialogueFrameActionOperation }>
  ): DialogueFrameActionValue | DialogueFrameActionNumericValue {
    return "quantity" in action ? action.quantity : action.value
  }

  private setActionValue(
    action: Extract<DialogueFrameActionData, { operation: DialogueFrameActionOperation }>,
    value: DialogueFrameActionValue | DialogueFrameActionNumericValue
  ) {
    if ("quantity" in action) {
      action.quantity = this.normalizeNumericActionValue(value)
    } else {
      action.value = value
    }
  }

  private normalizeNumericActionValue(value: DialogueFrameActionValue | DialogueFrameActionNumericValue): DialogueFrameActionNumericValue {
    if (this.isRangeValue(value)) {
      return value
    }

    return Number(value) || 0
  }

  private createRangeValue(value: DialogueFrameActionValue | DialogueFrameActionNumericValue) {
    const fixedValue = Number(this.getFixedValueFromActionValue(value)) || 0

    return {
      mode: "range" as const,
      min: fixedValue,
      max: fixedValue,
      numberType: "integer" as const,
    }
  }

  private getFixedValueFromActionValue(value: DialogueFrameActionValue | DialogueFrameActionNumericValue): string | number | boolean {
    if (!this.isRangeValue(value)) {
      return value
    }

    return value.min
  }

  private isRangeValue(value: unknown): value is Extract<DialogueFrameActionValue, { mode: "range" }> {
    return Boolean(value && typeof value === "object" && (value as { mode?: string }).mode === "range")
  }

  private parseNumber(value: string, fallback: number): number {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? fallback : parsed
  }

  private formatActionValue(value: DialogueFrameActionValue | DialogueFrameActionNumericValue): string {
    if (this.isRangeValue(value)) {
      const suffix = value.numberType === "integer" ? "int" : "float"
      return `[${value.min}..${value.max} ${suffix}]`
    }

    return String(value)
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
