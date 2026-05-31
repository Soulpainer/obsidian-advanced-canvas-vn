import { Notice, TFile } from "obsidian"
import { DialogueCharacterDefinition } from "src/@types/DialogueCanvas"

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