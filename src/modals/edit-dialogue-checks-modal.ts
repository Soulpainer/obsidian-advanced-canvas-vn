import { ButtonComponent, Modal, Notice, Setting } from "obsidian"
import {
  DialogueAnswerCheckItem,
  DialogueAnswerChecksData,
  DialogueChecksMode,
  DialogueStatDefinition,
} from "src/@types/DialogueCanvas"

export interface EditDialogueChecksModalOptions {
  initialValue?: DialogueAnswerChecksData
  stats: DialogueStatDefinition[]
  onSubmit: (value: DialogueAnswerChecksData | undefined) => void
}

export default class EditDialogueChecksModal extends Modal {
  private mode: DialogueChecksMode
  private items: DialogueAnswerCheckItem[]
  private readonly stats: DialogueStatDefinition[]
  private readonly onSubmitCallback: (value: DialogueAnswerChecksData | undefined) => void

  constructor(app: any, options: EditDialogueChecksModalOptions) {
    super(app)

    this.mode = options.initialValue?.mode ?? "all"
    this.items = options.initialValue?.items?.length
      ? options.initialValue.items.map(item => ({ ...item }))
      : []

    this.stats = options.stats
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
    contentEl.createEl("h2", { text: "Edit Answer Checks" })

    if (this.stats.length === 0) {
      contentEl.createEl("p", {
        text: "No stats found. Create Dialogue/Stats.md in the vault.",
      })
    }

    new Setting(contentEl)
      .setName("Require all checks")
      .setDesc("Enabled: all listed checks must pass. Disabled: any one check can pass.")
      .addToggle(toggle => {
        toggle
          .setValue(this.mode === "all")
          .onChange(value => {
            this.mode = value ? "all" : "any"
          })
      })

    contentEl.createEl("h3", { text: "Checks" })

    if (this.items.length === 0) {
      contentEl.createEl("p", {
        text: "No checks yet.",
      })
    }

    this.items.forEach((item, index) => {
      const row = new Setting(contentEl)
        .setName(`Check ${index + 1}`)
        .setDesc("Stat and threshold")

      row.addDropdown(dropdown => {
        for (const stat of this.stats) {
          dropdown.addOption(stat.id, `${stat.name} (${stat.id})`)
        }

        dropdown
          .setValue(item.statId)
          .onChange(value => {
            const target = this.items[index]
            if (!target) return

            target.statId = value
          })
      })

      row.addText(text => {
        text
          .setPlaceholder("11")
          .setValue(String(item.threshold))
          .onChange(value => {
            const target = this.items[index]
            if (!target) return

            const parsed = Number.parseInt(value, 10)
            target.threshold = Number.isFinite(parsed) ? parsed : 0
          })
      })

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
          .setButtonText("Add Check")
          .onClick(() => {
            const firstStatId = this.stats[0]?.id ?? ""

            if (!firstStatId) {
              new Notice("Dialogue Canvas: no stats available")
              return
            }

            this.items.push({
              statId: firstStatId,
              threshold: 10,
            })

            this.render()
          })
      })

    new Setting(contentEl)
      .addButton((button: ButtonComponent) => {
        button
          .setButtonText("Clear Checks")
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
              return item.statId && Number.isFinite(item.threshold)
            })

            if (validItems.length === 0) {
              new Notice("Dialogue Canvas: no valid checks")
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
}