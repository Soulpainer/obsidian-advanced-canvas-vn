import { Notice, TFile } from "obsidian"
import {
  DialoguePropertyDefinition,
  DialoguePropertyType,
} from "src/@types/DialogueCanvas"

const DEFAULT_PROPERTIES_FILE_PATH = "Dialogue/Properties.md"

export default class DialoguePropertiesLoader {
  static async loadProperties(app: any): Promise<DialoguePropertyDefinition[]> {
    const file = app.vault.getAbstractFileByPath(DEFAULT_PROPERTIES_FILE_PATH)

    if (!(file instanceof TFile)) {
      new Notice(`Dialogue Canvas: ${DEFAULT_PROPERTIES_FILE_PATH} not found`)
      return []
    }

    try {
      const raw = await app.vault.read(file)
      const properties = this.parsePropertiesMarkdownTable(raw)

      if (properties.length === 0) {
        new Notice(`Dialogue Canvas: no properties found in ${DEFAULT_PROPERTIES_FILE_PATH}`)
      }

      return properties
    } catch (error) {
      console.error("[Dialogue Canvas] Failed to load properties", error)
      new Notice(`Dialogue Canvas: failed to load ${DEFAULT_PROPERTIES_FILE_PATH}`)
      return []
    }
  }

  private static parsePropertiesMarkdownTable(markdown: string): DialoguePropertyDefinition[] {
    const lines = markdown
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)

    const tableStartIndex = lines.findIndex(line => {
      const normalized = line.toLowerCase()
      return (
        normalized.startsWith("|") &&
        normalized.includes("id") &&
        normalized.includes("name") &&
        normalized.includes("type")
      )
    })

    if (tableStartIndex < 0) {
      new Notice("Dialogue Canvas: properties table not found")
      return []
    }

    const headerLine = lines[tableStartIndex]
    const separatorLine = lines[tableStartIndex + 1]

    if (!headerLine) {
      new Notice("Dialogue Canvas: invalid properties table header")
      return []
    }

    if (!separatorLine || !separatorLine.startsWith("|")) {
      new Notice("Dialogue Canvas: invalid properties table")
      return []
    }

    const headers = this.parseTableRow(headerLine).map(value => value.toLowerCase())

    const idIndex = headers.indexOf("id")
    const nameIndex = headers.indexOf("name")
    const typeIndex = headers.indexOf("type")
    const groupIndex = headers.indexOf("group")
    const defaultIndex = headers.indexOf("default")
    const descriptionIndex = headers.indexOf("description")

    if (idIndex < 0 || nameIndex < 0 || typeIndex < 0) {
      new Notice("Dialogue Canvas: properties table must contain id, name and type columns")
      return []
    }

    const result: DialoguePropertyDefinition[] = []

    for (let i = tableStartIndex + 2; i < lines.length; i++) {
      const line = lines[i]

      if (!line || !line.startsWith("|")) {
        break
      }

      const cells = this.parseTableRow(line)

      const id = cells[idIndex]?.trim()
      const name = cells[nameIndex]?.trim()
      const rawType = cells[typeIndex]?.trim().toLowerCase()

      if (!id || !name || !this.isValidType(rawType)) {
        continue
      }

      result.push({
        id,
        name,
        type: rawType,
        group: groupIndex >= 0 ? cells[groupIndex]?.trim() : undefined,
        defaultValue: defaultIndex >= 0 ? cells[defaultIndex]?.trim() : undefined,
        description: descriptionIndex >= 0 ? cells[descriptionIndex]?.trim() : undefined,
      })
    }

    return result
  }

  private static isValidType(value: string | undefined): value is DialoguePropertyType {
    return value === "bool" || value === "int" || value === "string"
  }

  private static parseTableRow(line: string): string[] {
    return line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map(cell => cell.trim())
  }
}