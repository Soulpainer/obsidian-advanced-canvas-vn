import { ButtonComponent, Modal, Notice, Setting } from "obsidian"
import {
  DialogueAnswerConditionItem,
  DialogueAnswerConditionsData,
  DialogueConditionMode,
  DialogueConditionOperator,
  DialogueConditionSource,
  DialogueConditionValue,
  DialoguePropertyDefinition,
  DialogueStatDefinition,
} from "src/@types/DialogueCanvas"

export interface EditDialogueConditionsModalOptions {
  initialValue?: DialogueAnswerConditionsData
  stats: DialogueStatDefinition[]
  properties: DialoguePropertyDefinition[]
  onSubmit: (value: DialogueAnswerConditionsData | undefined) => void
}

export default class EditDialogueConditionsModal extends Modal {
  private mode: DialogueConditionMode
  private items: DialogueAnswerConditionItem[]

  private readonly stats: DialogueStatDefinition[]
  private readonly properties: DialoguePropertyDefinition[]
  private readonly onSubmitCallback: (value: DialogueAnswerConditionsData | undefined) => void

  constructor(app: any, options: EditDialogueConditionsModalOptions) {
    super(app)

    this.mode = options.initialValue?.mode ?? "all"
    this.items = options.initialValue?.items?.length
      ? options.initialValue.items.map(item => ({ ...item }))
      : []

    this.stats = options.stats
    this.properties = options.properties
    this.onSubmitCallback = options.onSubmit
  }

  onOpen() {
    this.render()
  }

  onClose() {
    this.contentEl.empty()
  }

  private render() {
    const { contentEl } = this

    contentEl.empty()
    contentEl.createEl("h2", { text: "Edit Answer Conditions" })

    if (this.stats.length === 0) {
      contentEl.createEl("p", {
        text: "No stats found. Create Dialogue/Stats.md in the vault.",
      })
    }

    if (this.properties.length === 0) {
      contentEl.createEl("p", {
        text: "No properties found. Create Dialogue/Properties.md in the vault.",
      })
    }

    new Setting(contentEl)
      .setName("Require all conditions")
      .setDesc("Enabled: all conditions must be true. Disabled: any one condition is enough.")
      .addToggle(toggle => {
        toggle
          .setValue(this.mode === "all")
          .onChange(value => {
            this.mode = value ? "all" : "any"
          })
      })

    contentEl.createEl("h3", { text: "Conditions" })

    if (this.items.length === 0) {
      contentEl.createEl("p", {
        text: "No conditions yet.",
      })
    }

    this.items.forEach((item, index) => {
      const row = new Setting(contentEl)
        .setName(`Condition ${index + 1}`)
        .setDesc(this.getConditionDescription(item))

      row.addDropdown(dropdown => {
        dropdown.addOption("property", "Property")
        dropdown.addOption("stat", "Stat")

        dropdown
          .setValue(item.source)
          .onChange(value => {
            const target = this.items[index]
            if (!target) return

            const nextSource = value as DialogueConditionSource
            target.source = nextSource
            target.id = this.getDefaultIdForSource(nextSource)
            target.op = "=="
            target.value = this.getDefaultValueForItem(target)

            this.render()
          })
      })

      row.addDropdown(dropdown => {
        const options = item.source === "stat"
          ? this.stats.map(stat => ({
              id: stat.id,
              label: `${stat.name} (${stat.id})`,
            }))
          : this.properties.map(property => ({
              id: property.id,
              label: `${property.name} (${property.id})`,
            }))

        for (const option of options) {
          dropdown.addOption(option.id, option.label)
        }

        dropdown
          .setValue(item.id)
          .onChange(value => {
            const target = this.items[index]
            if (!target) return

            target.id = value
            target.value = this.getDefaultValueForItem(target)

            this.render()
          })
      })

      row.addDropdown(dropdown => {
        for (const op of this.getOperatorsForItem(item)) {
          dropdown.addOption(op, op)
        }

        dropdown
          .setValue(item.op)
          .onChange(value => {
            const target = this.items[index]
            if (!target) return

            target.op = value as DialogueConditionOperator

            if (target.op === "exists" || target.op === "notExists") {
              target.value = undefined
            } else if (target.value === undefined) {
              target.value = this.getDefaultValueForItem(target)
            }

            this.render()
          })
      })

      if (item.op !== "exists" && item.op !== "notExists") {
        this.addValueControl(row, item, index)
      }

      row.addButton(button => {
        button
          .setButtonText("Remove")
          .onClick(() => {
            this.items.splice(index, 1)
            this.render()
          })
      })
    })

    new Setting(contentEl)
      .addButton(button => {
        button
          .setButtonText("Add Property Condition")
          .onClick(() => {
            const id = this.getDefaultIdForSource("property")

            if (!id) {
              new Notice("Dialogue Canvas: no properties available")
              return
            }

            const item: DialogueAnswerConditionItem = {
              source: "property",
              id,
              op: "==",
              value: false,
            }

            item.value = this.getDefaultValueForItem(item)
            this.items.push(item)

            this.render()
          })
      })
      .addButton(button => {
        button
          .setButtonText("Add Stat Condition")
          .onClick(() => {
            const id = this.getDefaultIdForSource("stat")

            if (!id) {
              new Notice("Dialogue Canvas: no stats available")
              return
            }

            this.items.push({
              source: "stat",
              id,
              op: ">=",
              value: 1,
            })

            this.render()
          })
      })

    new Setting(contentEl)
      .addButton((button: ButtonComponent) => {
        button
          .setButtonText("Clear Conditions")
          .onClick(() => {
            this.onSubmitCallback(undefined)
            this.close()
          })
      })
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
            const validItems = this.items.filter(item => {
              if (!item.source || !item.id || !item.op) return false
              if (item.op === "exists" || item.op === "notExists") return true
              return item.value !== undefined && item.value !== ""
            })

            if (validItems.length === 0) {
              new Notice("Dialogue Canvas: no valid conditions")
              return
            }

            this.onSubmitCallback({
              mode: this.mode,
              items: validItems,
            })

            this.close()
          })
      })
  }

  private addValueControl(
    row: Setting,
    item: DialogueAnswerConditionItem,
    index: number
  ) {
    const property = item.source === "property"
      ? this.properties.find(candidate => candidate.id === item.id)
      : undefined

    if (property?.type === "bool") {
      row.addDropdown(dropdown => {
        dropdown.addOption("true", "true")
        dropdown.addOption("false", "false")

        dropdown
          .setValue(String(item.value ?? false))
          .onChange(value => {
            const target = this.items[index]
            if (!target) return

            target.value = value === "true"
          })
      })

      return
    }

    row.addText(text => {
      text
        .setPlaceholder(item.source === "stat" || property?.type === "int" ? "1" : "value")
        .setValue(item.value === undefined ? "" : String(item.value))
        .onChange(value => {
          const target = this.items[index]
          if (!target) return

          target.value = this.parseConditionValue(target, value)
        })
    })
  }

  private parseConditionValue(
    item: DialogueAnswerConditionItem,
    rawValue: string
  ): DialogueConditionValue {
    if (item.source === "stat") {
      const parsed = Number.parseInt(rawValue, 10)
      return Number.isFinite(parsed) ? parsed : 0
    }

    const property = this.properties.find(candidate => candidate.id === item.id)

    if (property?.type === "int") {
      const parsed = Number.parseInt(rawValue, 10)
      return Number.isFinite(parsed) ? parsed : 0
    }

    if (property?.type === "bool") {
      return rawValue === "true"
    }

    return rawValue
  }

  private getDefaultIdForSource(source: DialogueConditionSource): string {
    if (source === "stat") {
      return this.stats[0]?.id ?? ""
    }

    return this.properties[0]?.id ?? ""
  }

  private getDefaultValueForItem(item: DialogueAnswerConditionItem): DialogueConditionValue | undefined {
    if (item.op === "exists" || item.op === "notExists") {
      return undefined
    }

    if (item.source === "stat") {
      return 1
    }

    const property = this.properties.find(candidate => candidate.id === item.id)

    if (property?.type === "bool") {
      return property.defaultValue === "true"
    }

    if (property?.type === "int") {
      const parsed = Number.parseInt(property.defaultValue ?? "0", 10)
      return Number.isFinite(parsed) ? parsed : 0
    }

    return property?.defaultValue ?? ""
  }

  private getOperatorsForItem(item: DialogueAnswerConditionItem): DialogueConditionOperator[] {
    if (item.source === "stat") {
      return ["==", "!=", ">", ">=", "<", "<="]
    }

    const property = this.properties.find(candidate => candidate.id === item.id)

    if (property?.type === "bool") {
      return ["exists", "notExists", "==", "!="]
    }

    if (property?.type === "int") {
      return ["exists", "notExists", "==", "!=", ">", ">=", "<", "<="]
    }

    return ["exists", "notExists", "==", "!="]
  }

  private getConditionDescription(item: DialogueAnswerConditionItem): string {
    if (item.op === "exists" || item.op === "notExists") {
      return `${item.source}.${item.id} ${item.op}`
    }

    return `${item.source}.${item.id} ${item.op} ${String(item.value ?? "")}`
  }
}