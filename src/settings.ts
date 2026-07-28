// LLM agent change: this file was reduced from the upstream Advanced Canvas settings module
// (~900 lines, ~95 settings for presentations/portals/styling/etc.) to a minimal skeleton.
//
// Rationale: the dialogue system never reads any setting. Every upstream canvas extension and
// patcher that consumed these settings was removed, so the SETTINGS object, the type interface
// it derived from, and the CSS-styles-manager wiring became dead code. What remains is the
// SettingsManager shape that main.ts constructs at boot, with an empty settings record. New
// dialogue-specific settings can be added to `AdvancedCanvasPluginSettingsValues` as needed.
import { PluginSettingTab } from "obsidian"
import AdvancedCanvasPlugin from "./main"

// Empty for now. Add dialogue-specific settings here when the need arises (e.g. default paths
// for the Dialogue/ markdown tables, choice-id strategy, render options).
export interface AdvancedCanvasPluginSettingsValues {}

export const DEFAULT_SETTINGS_VALUES: AdvancedCanvasPluginSettingsValues = {}

export default class SettingsManager {
  private plugin: AdvancedCanvasPlugin
  private settings: AdvancedCanvasPluginSettingsValues
  private settingsTab: AdvancedCanvasPluginSettingTab

  constructor(plugin: AdvancedCanvasPlugin) {
    this.plugin = plugin
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS_VALUES, await this.plugin.loadData())
    this.plugin.app.workspace.trigger("advanced-canvas:settings-changed")
  }

  async saveSettings() {
    await this.plugin.saveData(this.settings)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature kept for API parity with the base class guard in canvas-extension.ts; no keys exist yet.
  getSetting<T extends keyof AdvancedCanvasPluginSettingsValues>(_key: T): AdvancedCanvasPluginSettingsValues[T] {
    return this.settings[_key]
  }

  async setSetting(data: Partial<AdvancedCanvasPluginSettingsValues>) {
    this.settings = Object.assign(this.settings, data)
    await this.saveSettings()
    this.plugin.app.workspace.trigger("advanced-canvas:settings-changed")
  }

  addSettingsTab() {
    this.settingsTab = new AdvancedCanvasPluginSettingTab(this.plugin, this)
    this.plugin.addSettingTab(this.settingsTab)
  }
}

export class AdvancedCanvasPluginSettingTab extends PluginSettingTab {
  settingsManager: SettingsManager

  constructor(plugin: AdvancedCanvasPlugin, settingsManager: SettingsManager) {
    super(plugin.app, plugin)
    this.settingsManager = settingsManager
  }

  display(): void {
    const { containerEl } = this
    containerEl.empty()

    // LLM agent change: no settings are exposed yet. The dialogue editor has no user-tunable
    // options for now; placeholder text explains where future settings will live.
    containerEl.createEl("p", {
      text: "VN Canvas has no configurable settings yet. Dialogue data is authored directly on the canvas and in the Dialogue/ markdown tables (Characters.md, Stats.md, Properties.md, Triggers.md).",
    })
  }
}
