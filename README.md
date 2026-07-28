# VN Canvas

A visual-novel **dialogue graph editor** built on Obsidian Canvas.

VN Canvas turns an Obsidian Canvas into an authoring surface for branching dialogue: nodes are
dialogue *frames*, edges are *routes* between them. The graph — plus a handful of markdown tables
that define characters, stats, properties and triggers — is the data a Unity runtime consumes to
play the game.

This is a **fork** of [Developer-Mike's Advanced Canvas](https://github.com/Developer-Mike/obsidian-advanced-canvas).
The canvas infrastructure is upstream; the dialogue system (`x-dialogue`) is what this fork adds.
See [`docs/`](./docs) for the data contract with the Unity runtime.

> [!NOTE]
> LLM-assisted project. Changes that were authored by an LLM agent are marked as such in commit
> messages and in-code comments, per `AGENTS.md`.

## What it does

- **Dialogue frames** — a node holds a speaker, the line of dialogue, choices, and actions.
  Double-click a frame to open the frame editor.
- **Choices & routes** — each choice can route to a different target frame. A route edge is bound
  to a `choiceId` + an `outcome` (success/failure). Failure routes render as dashed edges.
- **Stat checks & conditions** — choices can gate on character stats (checks) and on
  stat/property comparisons (conditions).
- **Actions** — frames carry actions (fire a trigger, set a global property, change a character
  stat or inventory item), either to a fixed value or to a random value within a range.
- **Routing points** — small transparent helper nodes for tidying up edge routing.
- **Start / end** — a canvas marks its start node; a frame with no outgoing routes is a terminal.

## Project data layout

In the vault, a VN Canvas project is:

| Source | Role |
| --- | --- |
| `*.canvas` | The dialogue graph itself. Frames, routes, and per-node/per-edge `x-dialogue` metadata. |
| `Dialogue/Characters.md` | Character definitions (id, display name, color, …). |
| `Dialogue/Stats.md` | Character stat definitions. |
| `Dialogue/Properties.md` | Global property definitions. |
| `Dialogue/Triggers.md` | Named triggers that frames' actions can fire. |

Each of those is a pipe (`|`) markdown table that the plugin parses at edit time and that the
Unity runtime reads at build/runtime. See
[`docs/unity-dialogue-data-format.md`](./docs/unity-dialogue-data-format.md) for the exact schema.

## Installation

This is not (yet) a community plugin. Install manually:

1. Create a folder named `vn-canvas` in your vault's plugins folder
   (`<vault>/.obsidian/plugins/`).
2. Put `main.js`, `styles.css` and `manifest.json` into that folder.
3. Enable the plugin under *Settings → Community plugins*.

If you previously had upstream `advanced-canvas` installed, remove that folder first — the two are
independent plugins and you do not need both.

### Deploying from this repository

```bash
npm run build     # production build into ./dist
npm run deploy    # build + copy main.js / styles.css / manifest.json into the vault plugin folder
```

`npm run deploy` copies into
`<vault>/.obsidian/plugins/vn-canvas/` by default; override with `VAULT_PLUGIN_DIR=...`.

After deploying, toggle the plugin off/on in Obsidian (or restart Obsidian) to pick up the new
build — `Ctrl+R` does not reload plugins.

## Development

```bash
npm install
npm run dev    # esbuild watch
npm run build  # production build
npm run lint   # eslint
npx tsc --noEmit   # type check (no emit)
```

## Credits & license

Built on [Advanced Canvas](https://github.com/Developer-Mike/obsidian-advanced-canvas) by
Developer-Mike. See `LICENSE` for the upstream GPL-3.0 terms.
