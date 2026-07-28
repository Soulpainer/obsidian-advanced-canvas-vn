// LLM agent change: deployment helper that builds the plugin in production mode
// and copies the three deployable artifacts into the Obsidian vault plugin folder.
//
// Usage:
//   npm run deploy
//   VAULT_PLUGIN_DIR="C:/path/to/vault/.obsidian/plugins/advanced-canvas" npm run deploy
//
// The default target points to the MetaLor vault on this machine. Override with
// VAULT_PLUGIN_DIR if you target a different vault.
import { execSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "..")

// Default: MetaLor vault on this machine. Override via env when needed.
const DEFAULT_VAULT_PLUGIN_DIR =
  "C:/Users/Lenovo/Documents/docs/MetaLor/.obsidian/plugins/advanced-canvas"

const targetDir = process.env.VAULT_PLUGIN_DIR || DEFAULT_VAULT_PLUGIN_DIR
const artifacts = ["main.js", "styles.css", "manifest.json"]

function log(message) {
  // eslint-disable-next-line no-console -- deploy is a CLI tool, console output is expected.
  console.log(`[deploy] ${message}`)
}

log("Building plugin in production mode...")
execSync("node esbuild.config.mjs production", { stdio: "inherit", cwd: projectRoot })

if (!existsSync(targetDir)) {
  log(`Target plugin folder does not exist, creating it: ${targetDir}`)
  mkdirSync(targetDir, { recursive: true })
}

for (const file of artifacts) {
  const from = resolve(projectRoot, "dist", file)
  const to = resolve(targetDir, file)

  if (!existsSync(from)) {
    console.error(`[deploy] ERROR: expected artifact not found: ${from}`)
    process.exit(1)
  }

  copyFileSync(from, to)
  log(`copied ${file} -> ${to}`)
}

log("Done. Reload the plugin in Obsidian (or restart Obsidian) to pick up the new build.")
