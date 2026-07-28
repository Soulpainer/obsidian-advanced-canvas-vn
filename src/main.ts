import { ItemView, Plugin } from 'obsidian'
import { Canvas, CanvasView } from './@types/Canvas'

// Utils
import IconsHelper from './utils/icons-helper'
import DebugHelper from './utils/debug-helper'

// Managers
import SettingsManager from './settings'
import WindowsManager from './managers/windows-manager'

// Patchers
import Patcher from './patchers/patcher'
import CanvasPatcher from './patchers/canvas-patcher'

// Canvas Extensions
import CanvasExtension from './canvas-extensions/canvas-extension'
import MetadataCanvasExtension from './canvas-extensions/metadata-canvas-extension'
import DialogueChoiceRouteCanvasExtension from './canvas-extensions/dialogue-choice-route-canvas-extension'
import DialogueFrameCanvasExtension from './canvas-extensions/dialogue-frame-canvas-extension'
import DialogueRouterCanvasExtension from './canvas-extensions/dialogue-router-canvas-extension'

// Dataset Exposers
import CanvasMetadataExposerExtension from './canvas-extensions/dataset-exposers/canvas-metadata-exposer'

// LLM agent change: trimmed PATCHERS to only what the dialogue system needs. The canvas patcher
// monkey-patches Obsidian's Canvas internals and emits all `advanced-canvas:*` workspace events
// that the dialogue extensions listen to. The upstream metadata/search/embed/link patchers were
// removed — they power upstream features (graph view integration, search, backlinks) that this
// fork no longer ships.
const PATCHERS = [
  CanvasPatcher,
]

// LLM agent change: trimmed CANVAS_EXTENSIONS to the dialogue system plus the minimal canvas
// metadata infrastructure it depends on (MetadataCanvasExtension proxies canvas.metadata for
// start/end node markers; CanvasMetadataExposerExtension exposes them as dataset attributes).
// The upstream feature extensions and the extra dataset exposers were removed.
const CANVAS_EXTENSIONS: typeof CanvasExtension[] = [
  MetadataCanvasExtension,
  CanvasMetadataExposerExtension,
  DialogueFrameCanvasExtension,
  DialogueRouterCanvasExtension,
  DialogueChoiceRouteCanvasExtension
]

export default class AdvancedCanvasPlugin extends Plugin {
  debugHelper: DebugHelper

  settings: SettingsManager
  windowsManager: WindowsManager

  patchers: Patcher[]
  canvasExtensions: CanvasExtension[]

  async onload() {
    IconsHelper.addIcons()

    this.settings = new SettingsManager(this)
    await this.settings.loadSettings()
    this.settings.addSettingsTab()

    this.windowsManager = new WindowsManager(this)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Just use any to avoid type issues
    this.patchers = PATCHERS.map((Patcher: any) => {
      if (!Patcher) return

      try { return new Patcher(this) }
      catch (e) {
        console.error(`Error initializing patcher ${Patcher.name}:`, e)
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Just use any to avoid type issues
    this.canvasExtensions = CANVAS_EXTENSIONS.map((Extension: any) => {
      try { return new Extension(this) }
      catch (e) {
        console.error(`Error initializing ac-extension ${Extension.name}:`, e)
      }
    })
  }

  onunload() {}

  getCanvases(): Canvas[] {
    return this.app.workspace.getLeavesOfType('canvas')
      .map(leaf => (leaf.view as CanvasView)?.canvas)
      .filter(canvas => canvas)
  }

  getCurrentCanvasView(): CanvasView | null {
    const canvasView = this.app.workspace.getActiveViewOfType(ItemView)
    if (canvasView?.getViewType() !== 'canvas') return null
    return canvasView as CanvasView
  }

  getCurrentCanvas(): Canvas | null {
    return this.getCurrentCanvasView()?.canvas || null
  }

  createFileSnapshot(path: string, content: string) {
    const fileRecoveryPlugin = this.app.internalPlugins.plugins['file-recovery']?.instance
    if (!fileRecoveryPlugin) return

    fileRecoveryPlugin.forceAdd(path, content)
  }

  // this.app.plugins.plugins["advanced-canvas"].enableDebugMode()
  enableDebugMode() {
    if (this.debugHelper) return
    this.debugHelper = new DebugHelper(this)
  }
}
