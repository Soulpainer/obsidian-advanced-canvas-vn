import { Notice, TFile } from "obsidian"
import { DialogueCharacterDefinition, DialogueInventoryItem, DialogueStatValueMap } from "src/@types/DialogueCanvas"

const DEFAULT_CHARACTERS_FILE_PATH = "Dialogue/Characters.md"

export default class DialogueCharactersLoader {
  static async loadCharacters(app: any): Promise<DialogueCharacterDefinition[]> {
    const file = app.vault.getAbstractFileByPath(DEFAULT_CHARACTERS_FILE_PATH)

    if (!(file instanceof TFile)) {
      new Notice(`Dialogue Canvas: ${DEFAULT_CHARACTERS_FILE_PATH} not found`)
      return []
    }

    try {
      const raw = await app.vault.read(file)
      const characters = this.parseCharactersMarkdownTable(raw)

      if (characters.length === 0) {
        new Notice(`Dialogue Canvas: no characters found in ${DEFAULT_CHARACTERS_FILE_PATH}`)
      }

      return characters
    } catch (error) {
      console.error("[Dialogue Canvas] Failed to load characters", error)
      new Notice(`Dialogue Canvas: failed to load ${DEFAULT_CHARACTERS_FILE_PATH}`)
      return []
    }
  }

  private static parseCharactersMarkdownTable(markdown: string): DialogueCharacterDefinition[] {
    const lines = markdown
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)

    const tableStartIndex = lines.findIndex(line => {
      const normalized = line.toLowerCase()
      return (
        normalized.startsWith("|") &&
        normalized.includes("id") &&
        normalized.includes("name")
      )
    })

    if (tableStartIndex < 0) {
      new Notice("Dialogue Canvas: characters table not found")
      return []
    }

    const headerLine = lines[tableStartIndex]
    const separatorLine = lines[tableStartIndex + 1]

    if (!headerLine) {
      new Notice("Dialogue Canvas: invalid characters table header")
      return []
    }

    if (!separatorLine || !separatorLine.startsWith("|")) {
      new Notice("Dialogue Canvas: invalid characters table")
      return []
    }

    const headers = this.parseTableRow(headerLine).map(value => value.toLowerCase())

    const idIndex = headers.indexOf("id")
    const nameIndex = headers.indexOf("name")
    const portraitIndex = headers.indexOf("portrait")
    const colorIndex = headers.indexOf("color")
    const statsIndex = headers.indexOf("stats")
    const inventoryIndex = headers.indexOf("inventory")
    const descriptionIndex = headers.indexOf("description")

    if (idIndex < 0 || nameIndex < 0) {
      new Notice("Dialogue Canvas: characters table must contain id and name columns")
      return []
    }

    const result: DialogueCharacterDefinition[] = []

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
        portrait: portraitIndex >= 0 ? cells[portraitIndex]?.trim() : undefined,
        color: colorIndex >= 0 ? cells[colorIndex]?.trim() : undefined,
        stats: statsIndex >= 0 ? this.parseStats(cells[statsIndex]) : undefined,
        inventory: inventoryIndex >= 0 ? this.parseInventory(cells[inventoryIndex]) : undefined,
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

  // LLM agent change: every dialogue character can carry the same runtime data, player-controlled or not.
  private static parseStats(raw: string | undefined): DialogueStatValueMap | undefined {
    const text = raw?.trim()

    if (!text) {
      return undefined
    }

    const result: DialogueStatValueMap = {}

    for (const part of text.split(/[;,]/)) {
      const [rawId, rawValue] = part.split("=")
      const id = rawId?.trim()
      const value = Number(rawValue?.trim())

      if (!id || Number.isNaN(value)) {
        continue
      }

      result[id] = value
    }

    return Object.keys(result).length > 0 ? result : undefined
  }

  private static parseInventory(raw: string | undefined): DialogueInventoryItem[] | undefined {
    const text = raw?.trim()

    if (!text) {
      return undefined
    }

    const result: DialogueInventoryItem[] = []

    for (const part of text.split(/[;,]/)) {
      const [rawId, rawQuantity] = part.split("=")
      const id = rawId?.trim()
      const quantity = rawQuantity === undefined ? undefined : Number(rawQuantity.trim())

      if (!id || (quantity !== undefined && Number.isNaN(quantity))) {
        continue
      }

      result.push({
        id,
        quantity,
      })
    }

    return result.length > 0 ? result : undefined
  }
}
