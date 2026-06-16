import { Notice, TFile } from "obsidian"
import { DialogueStatDefinition } from "src/@types/DialogueCanvas"

const DEFAULT_STATS_FILE_PATH = "Dialogue/Stats.md"

export default class DialogueStatsLoader {
  static async loadStats(app: any): Promise<DialogueStatDefinition[]> {
    const file = app.vault.getAbstractFileByPath(DEFAULT_STATS_FILE_PATH)

    if (!(file instanceof TFile)) {
      new Notice(`Dialogue Canvas: ${DEFAULT_STATS_FILE_PATH} not found`)
      return []
    }

    try {
      const raw = await app.vault.read(file)
      const stats = this.parseStatsMarkdownTable(raw)

      if (stats.length === 0) {
        new Notice(`Dialogue Canvas: no stats found in ${DEFAULT_STATS_FILE_PATH}`)
      }

      return stats
    } catch (error) {
      console.error("[Dialogue Canvas] Failed to load stats", error)
      new Notice(`Dialogue Canvas: failed to load ${DEFAULT_STATS_FILE_PATH}`)
      return []
    }
  }

  private static parseStatsMarkdownTable(markdown: string): DialogueStatDefinition[] {
    const lines = markdown
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)

    const tableStartIndex = lines.findIndex(line => {
      const normalized = line.toLowerCase()
      return normalized.startsWith("|") && normalized.includes("id") && normalized.includes("name")
    })

    if (tableStartIndex < 0) {
      new Notice("Dialogue Canvas: stats table not found")
      return []
    }

    const headerLine = lines[tableStartIndex]
    const separatorLine = lines[tableStartIndex + 1]

    if (!headerLine) {
      new Notice("Dialogue Canvas: invalid stats table header")
      return []
    }

    if (!separatorLine || !separatorLine.startsWith("|")) {
      new Notice("Dialogue Canvas: invalid stats table")
      return []
    }

    const headers = this.parseTableRow(headerLine).map(value => value.toLowerCase())

    const idIndex = headers.indexOf("id")
    const nameIndex = headers.indexOf("name")
    const iconIndex = headers.indexOf("icon")
    const groupIndex = headers.indexOf("group")
    const descriptionIndex = headers.indexOf("description")

    if (idIndex < 0 || nameIndex < 0) {
      new Notice("Dialogue Canvas: stats table must contain id and name columns")
      return []
    }

    const result: DialogueStatDefinition[] = []

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
        icon: iconIndex >= 0 ? cells[iconIndex]?.trim() : undefined,
        group: groupIndex >= 0 ? cells[groupIndex]?.trim() : undefined,
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
