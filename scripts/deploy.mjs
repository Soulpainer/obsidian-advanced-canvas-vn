// LLM agent change: deployment helper that builds the plugin in production mode
// and copies the three deployable artifacts into the Obsidian vault plugin folder.
//
// Usage:
//   npm run deploy
//   npm run deploy:dialog-test
//   node scripts/deploy.mjs C:/path/to/vault/.obsidian/plugins/vn-canvas
//   VAULT_PLUGIN_DIR="C:/path/to/vault/.obsidian/plugins/advanced-canvas" npm run deploy
//
// The default target points to the MetaLor vault on this machine. Override via a
// positional arg (npm run deploy -- <path>) or VAULT_PLUGIN_DIR env var.
import { execSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "..")

// Default: MetaLor vault on this machine. Override via env when needed.
// LLM agent change: target folder renamed to vn-canvas to match the new plugin id.
const DEFAULT_VAULT_PLUGIN_DIR =
  "C:/Users/Lenovo/Documents/docs/MetaLor/.obsidian/plugins/vn-canvas"

const targetDir = process.argv[2] || process.env.VAULT_PLUGIN_DIR || DEFAULT_VAULT_PLUGIN_DIR
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
