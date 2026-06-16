import { Notice, TFile } from "obsidian"
import { DialogueTriggerDefinition } from "src/@types/DialogueCanvas"

const DEFAULT_TRIGGERS_FILE_PATH = "Dialogue/Triggers.md"

export default class DialogueTriggersLoader {
  static async loadTriggers(app: any): Promise<DialogueTriggerDefinition[]> {
    const file = app.vault.getAbstractFileByPath(DEFAULT_TRIGGERS_FILE_PATH)

    if (!(file instanceof TFile)) {
      new Notice(`Dialogue Canvas: ${DEFAULT_TRIGGERS_FILE_PATH} not found`)
      return []
    }

    try {
      const raw = await app.vault.read(file)
      const triggers = this.parseTriggersMarkdownTable(raw)

      if (triggers.length === 0) {
        new Notice(`Dialogue Canvas: no triggers found in ${DEFAULT_TRIGGERS_FILE_PATH}`)
      }

      return triggers
    } catch (error) {
      console.error("[Dialogue Canvas] Failed to load triggers", error)
      new Notice(`Dialogue Canvas: failed to load ${DEFAULT_TRIGGERS_FILE_PATH}`)
      return []
    }
  }

  private static parseTriggersMarkdownTable(markdown: string): DialogueTriggerDefinition[] {
    const lines = markdown
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)

    const tableStartIndex = lines.findIndex(line => {
      const normalized = line.toLowerCase()
      return normalized.startsWith("|") && normalized.includes("id") && normalized.includes("name")
    })

    if (tableStartIndex < 0) {
      new Notice("Dialogue Canvas: triggers table not found")
      return []
    }

    const headerLine = lines[tableStartIndex]
    const separatorLine = lines[tableStartIndex + 1]

    if (!headerLine) {
      new Notice("Dialogue Canvas: invalid triggers table header")
      return []
    }

    if (!separatorLine || !separatorLine.startsWith("|")) {
      new Notice("Dialogue Canvas: invalid triggers table")
      return []
    }

    const headers = this.parseTableRow(headerLine).map(value => value.toLowerCase())

    const idIndex = headers.indexOf("id")
    const nameIndex = headers.indexOf("name")
    const descriptionIndex = headers.indexOf("description")

    if (idIndex < 0 || nameIndex < 0) {
      new Notice("Dialogue Canvas: triggers table must contain id and name columns")
      return []
    }

    const result: DialogueTriggerDefinition[] = []

    for (let i = tableStartIndex + 2; i < lines.length; i++) {
      const line = lines[i]

      if (!line || !line.startsWith("|")) {
        break
      }

      const cells = this.parseTableRow(line)
      const id = cells[idIndex]?.trim()
      const name = cells[nameIndex]?.trim()

      if (!id || !name) {
        continue
      }

      result.push({
        id,
        name,
        description: descriptionIndex >= 0 ? cells[descriptionIndex]?.trim() : undefined,
      })
    }

    return result
  }

  private static parseTableRow(line: string): string[] {
    return line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map(cell => cell.trim())
  }
}
