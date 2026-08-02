# Unity Dialogue Data Format

> LLM agent change: this document was prepared by an LLM agent to describe the Obsidian dialogue data model for Unity/runtime agents.

This project stores dialogue authoring data directly inside an Obsidian vault. Unity can read the vault folder as project data and parse:

- `*.canvas` dialogue graph files.
- Markdown tables in `Dialogue/*.md`.
- Custom JSON metadata stored under `x-dialogue`.

Each dialogue should be treated as one canvas file. Canvas nodes are dialogue frames or routing points. Canvas edges connect choices to next nodes.

## Vault Files

The current editor expects these optional support files:

- `Dialogue/Characters.md`
- `Dialogue/Stats.md`
- `Dialogue/Properties.md`
- `Dialogue/Triggers.md`

All four are Markdown files containing one table. Parse the first table whose header has the required columns.

### `Dialogue/Stats.md`

Required columns:

```md
| id | name |
| --- | --- |
```

Optional columns:

```md
| icon | group | description |
```

Example:

```md
| id | name | icon | group | description |
| --- | --- | --- | --- | --- |
| courage | Courage | ⚔ | mind | Used for brave choices |
| tech | Tech | ⚙ | skill | Used for engineering checks |
```

Runtime shape:

```ts
interface DialogueStatDefinition {
  id: string
  name: string
  icon?: string
  group?: string
  description?: string
}
```

### `Dialogue/Properties.md`

Required columns:

```md
| id | name | type |
| --- | --- | --- |
```

`type` must be one of:

- `bool`
- `int`
- `string`

Optional columns:

```md
| group | default | description |
```

Example:

```md
| id | name | type | default | description |
| --- | --- | --- | --- | --- |
| alarm_on | Alarm On | bool | false | Global station alarm state |
| trust_level | Trust Level | int | 0 | Global trust counter |
```

Runtime shape:

```ts
interface DialoguePropertyDefinition {
  id: string
  name: string
  type: "bool" | "int" | "string"
  group?: string
  defaultValue?: string
  description?: string
}
```

### `Dialogue/Characters.md`

Required columns:

```md
| id | name |
| --- | --- |
```

Optional columns:

```md
| portrait | color | stats | inventory | description |
```

`stats` format:

```txt
courage=2; tech=5
```

`inventory` format:

```txt
medkit=1; keycard=1; coin=5
```

If an item has no quantity, it can be written as just an id, but Unity should normalize missing quantity according to game rules.

Example:

```md
| id | name | portrait | color | stats | inventory | description |
| --- | --- | --- | --- | --- | --- | --- |
| player | Player | Assets/Portraits/player.png | #3b82f6 | courage=2; tech=1 | coin=3 | The controlled character |
| engineer | Mira | Assets/Portraits/mira.png | #22c55e | tech=5 | keycard=1 | Station engineer |
```

Runtime shape:

```ts
type DialogueStatValueMap = Record<string, number>

interface DialogueInventoryItem {
  id: string
  quantity?: number
}

interface DialogueCharacterDefinition {
  id: string
  name: string
  portrait?: string
  color?: string
  stats?: DialogueStatValueMap
  inventory?: DialogueInventoryItem[]
  description?: string
}
```

### `Dialogue/Triggers.md`

Required columns:

```md
| id | name |
| --- | --- |
```

Optional columns:

```md
| description |
```

Example:

```md
| id | name | description |
| --- | --- | --- |
| alarm_on | Turn Alarm On | Starts the station alarm |
| quest_started | Quest Started | Marks quest start |
```

Runtime shape:

```ts
interface DialogueTriggerDefinition {
  id: string
  name: string
  description?: string
}
```

## Canvas Files

Canvas files are JSON. Unity should parse them as JSON and inspect:

```ts
interface CanvasData {
  nodes: CanvasNodeData[]
  edges: CanvasEdgeData[]
  metadata?: Record<string, unknown>
}
```

Dialogue-specific data lives in:

```txt
node["x-dialogue"]
edge["x-dialogue"]
canvas.metadata.startNode
canvas.metadata.endNode
```

### Canvas Metadata

Dialogue canvas metadata:

```json
{
  "metadata": {
    "startNode": "node-id",
    "endNode": "node-id"
  }
}
```

`startNode` is the graph entry point.

`endNode` is the current single terminal marker used by the editor. A frame can also simply have no valid outgoing route; Unity may treat that as terminal too.

## Dialogue Frame Nodes

A dialogue frame is a canvas text node with:

```json
{
  "id": "node-id",
  "type": "text",
  "text": "Displayed line text",
  "x": 100,
  "y": 100,
  "width": 360,
  "height": 220,
  "x-dialogue": {
    "frame": {
      "frameId": "stable_frame_id",
      "speakerId": "character_id",
      "choices": [],
      "actions": []
    }
  }
}
```

Important fields:

- `id`: canvas node id. Edges use this.
- `text`: the displayed dialogue line.
- `x-dialogue.frame.frameId`: stable semantic id for game data.
- `x-dialogue.frame.speakerId`: optional character id from `Dialogue/Characters.md`.
- `x-dialogue.frame.choices`: player/NPC choice data owned by this frame.
- `x-dialogue.frame.actions`: side effects executed when the frame is entered.

Suggested Unity model:

```csharp
class DialogueFrame {
    public string NodeId;
    public string FrameId;
    public string SpeakerId;
    public string Text;
    public List<DialogueChoice> Choices;
    public List<DialogueFrameAction> Actions;
}
```

## Routing Point Nodes

A routing point is a helper node used only to route lines visually:

```json
{
  "id": "router-id",
  "type": "text",
  "text": "",
  "width": 14,
  "height": 14,
  "x-dialogue": {
    "router": {
      "type": "point"
    }
  }
}
```

Runtime should not display routing points as dialogue frames.

When resolving graph flow, routing points are transparent nodes:

1. Enter route point.
2. Follow its single outgoing edge (this edge may be `type: "choice"` or `type: "unbound"` — follow it the same way regardless).
3. Continue until a dialogue frame or terminal is reached.

The editor enforces one outgoing edge from a route point, but Unity should still validate this.

## Choices

Choices belong to the source frame node, not to edges.

```ts
interface DialogueChoiceData {
  choiceId: string
  text: string
  hideWhenUnavailable?: boolean
  checks?: DialogueAnswerChecksData
  conditions?: DialogueAnswerConditionsData
}
```

Example:

```json
{
  "choiceId": "1",
  "text": "Ask about the ship",
  "hideWhenUnavailable": true,
  "checks": {
    "mode": "all",
    "items": [
      { "statId": "tech", "threshold": 3 }
    ]
  },
  "conditions": {
    "mode": "all",
    "items": [
      { "source": "property", "id": "met_engineer", "op": "==", "value": true }
    ]
  }
}
```

`choiceId` is internal route id. The editor keeps it as the visible 1-based choice number after filtering/saving. Unity should not allow designers to edit it manually.

### Checks

Checks are stat threshold tests:

```ts
interface DialogueAnswerChecksData {
  mode: "all" | "any"
  items: DialogueAnswerCheckItem[]
}

interface DialogueAnswerCheckItem {
  statId: string
  threshold: number
}
```

Suggested runtime interpretation:

- `all`: every listed stat must be `>= threshold`.
- `any`: at least one listed stat must be `>= threshold`.

Use the actor's runtime character stats. If a stat is missing, treat as `0`.

### Conditions

Conditions can inspect stats or properties:

```ts
type DialogueConditionSource = "stat" | "property"
type DialogueConditionOperator =
  | "exists"
  | "notExists"
  | "=="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="

interface DialogueAnswerConditionsData {
  mode: "all" | "any"
  items: DialogueAnswerConditionItem[]
}

interface DialogueAnswerConditionItem {
  source: DialogueConditionSource
  id: string
  op: DialogueConditionOperator
  value?: string | number | boolean
}
```

Suggested runtime interpretation:

- `source: "stat"` reads actor stat.
- `source: "property"` reads global property unless your runtime adds character-local properties.
- `exists`: key exists and is not null.
- `notExists`: key missing or null.
- Numeric comparisons should coerce numeric strings if needed.

## Choice Routes / Edges

Edges connect a source node to a target node. Choice binding is stored on the edge:

```json
{
  "id": "edge-id",
  "fromNode": "source-node-id",
  "fromSide": "right",
  "toNode": "target-node-id",
  "toSide": "left",
  "x-dialogue": {
    "route": {
      "type": "choice",
      "choiceId": "1",
      "outcome": "success",
      "choiceIndex": 0
    }
  }
}
```

Route shape:

```ts
type DialogueRouteType = "failure" | "choice" | "unbound" | "broken" | "unknown"

interface DialogueChoiceRouteData {
  type: "choice"
  choiceId: string
  outcome: "success" | "failure"
  choiceIndex?: number   // editor-only cache: index of the choice in sourceFrame.choices (0-based). Safe to ignore at runtime.
}
```

Interpretation:

- `choiceId` points to a choice in `sourceFrame.choices`.
- `outcome: "success"` is used when checks/conditions pass.
- `outcome: "failure"` is used when checks/conditions fail.
- A choice can have a success edge, a failure edge, both, or neither.
- Multiple choices can route to the same target node.
- `choiceIndex` is a cached editor value for coloring the edge; the runtime should NOT rely on it for logic (use `choiceId`). It may be absent on some edges.

Recommended Unity route lookup:

```txt
routesBySourceNode[sourceNodeId][choiceId][outcome] = edge.toNode
```

If `edge.toNode` is a routing point, resolve through routing points until a frame node is reached.

## Unbound Routes

<!-- LLM agent change: documented the "unbound" route type added by the router-as-color-transit feature. -->

An **unbound** route edge is a valid route line that is NOT bound to a specific choice. It is produced by the editor when an edge leaves a routing point whose incoming color is ambiguous (zero, multiple, or mixed incoming routes) — or leaves a routing point with no incoming routes at all.

```json
{
  "x-dialogue": {
    "route": {
      "type": "unbound"
    }
  }
}
```

```ts
interface DialogueUnboundRouteData {
  type: "unbound"
}
```

Runtime interpretation:

- An unbound edge is a **real route edge**, not a plain/decorative line. Treat it as a valid transition.
- It has no `choiceId` / `outcome` — it does not originate from a specific choice. It typically appears on the outgoing side of a routing point (see below).
- When resolving graph flow at a routing point: the outgoing edge may be choice OR unbound. Follow it the same way — a routing point has exactly one outgoing edge, so resolve through it regardless of type.

## Editor-only Route Types (validation states)

<!-- LLM agent change: documented the "broken" / "unknown" / legacy "failure" route types. These are
editor/validation states, NOT normal runtime transitions. -->

Three route types exist for editor/validation purposes and should be treated by the runtime as **graph errors**, not as valid transitions:

```ts
interface DialogueBrokenRouteData {
  type: "broken"
}

interface DialogueUnknownRouteData {
  type: "unknown"
}
```

- **`"broken"`** — a router's incoming choice reference is invalid (the choice was deleted from the source frame, or all incoming routes are themselves broken). The editor renders it as a red dashed line so the broken reference is visible. **Runtime: log a validation error and do not follow this edge** — the graph is malformed; the designer must fix the dangling choice reference in the canvas.
- **`"unknown"`** — a router has NO incoming route edges at all, so its outgoing edge has no source to inherit. The editor renders it as a grey dashed line. **Runtime: log a validation error** — the dialogue has an unreachable/disconnected segment. Do not follow this edge.
- **`"failure"`** — a legacy type retained for migration safety. At runtime, treat a route with `type:"failure"` the same as `type:"choice"` with `outcome:"failure"` (validate the choiceId; follow the failure branch). No new data is written with bare `type:"failure"`; it only appears in old files predating the `choice`/`unbound` split.

**Recommended importer behavior:** when a route of type `broken` or `unknown` is encountered, record it in the import error log and skip it (do not produce a resolved transition). The author then fixes the canvas and re-imports.

## Actions

Frame actions live in:

```txt
node["x-dialogue"].frame.actions
```

They are side effects to execute when the frame is entered. Execute them before presenting choices unless your game design says otherwise.

Action types:

```ts
type DialogueFrameActionOperation = "add" | "subtract" | "set"
type DialogueFrameActionType =
  | "trigger"
  | "globalProperty"
  | "characterStat"
  | "characterInventory"
```

### Trigger Action

```json
{
  "type": "trigger",
  "triggerId": "alarm_on"
}
```

Unity should map `triggerId` to game code/event dispatch. The trigger list from `Dialogue/Triggers.md` is definition/authoring metadata; action execution uses the id.

### Global Property Action

```json
{
  "type": "globalProperty",
  "propertyId": "alarm_level",
  "operation": "add",
  "value": 1
}
```

`propertyId` references `Dialogue/Properties.md`.

Operations:

- `add`: current value + action value.
- `subtract`: current value - action value.
- `set`: current value = action value.

For `bool` or `string` properties, prefer `set`. Unity should validate unsupported operations.

### Character Stat Action

```json
{
  "type": "characterStat",
  "characterId": "engineer",
  "statId": "tech",
  "operation": "add",
  "value": 1
}
```

`characterId` references `Dialogue/Characters.md`.

`statId` references `Dialogue/Stats.md`.

If the runtime character does not currently have that stat, start from `0`.

### Character Inventory Action

```json
{
  "type": "characterInventory",
  "characterId": "player",
  "itemId": "medkit",
  "operation": "add",
  "quantity": 1
}
```

`itemId` is a free string right now. There is no item definition file yet.

Recommended inventory interpretation:

- `add`: increase quantity.
- `subtract`: decrease quantity, clamp to `0` unless your game allows negative quantities.
- `set`: set exact quantity.

### Random Range Values

Action values can be fixed:

```json
1
```

or random ranges:

```json
{
  "mode": "range",
  "min": 1,
  "max": 5,
  "numberType": "integer"
}
```

`numberType`:

- `integer`: choose an integer between `min` and `max`, inclusive.
- `float`: choose a floating-point value between `min` and `max`.

Range values are supported in:

- `globalProperty.value`
- `characterStat.value`
- `characterInventory.quantity`

Suggested Unity helper:

```csharp
object ResolveActionValue(object rawValue) {
    if (rawValue is RangeValue range) {
        if (range.numberType == "integer") {
            return Random.Range((int)range.min, (int)range.max + 1);
        }

        return Random.Range(range.min, range.max);
    }

    return rawValue;
}
```

## Suggested Unity Import Pipeline

1. Load support tables:
   - `Dialogue/Stats.md`
   - `Dialogue/Properties.md`
   - `Dialogue/Characters.md`
   - `Dialogue/Triggers.md`

2. Load each dialogue `.canvas` file.

3. Build node maps:
   - `frameNodesByNodeId`
   - `frameNodesByFrameId`
   - `routerNodesByNodeId`

4. Build route maps from edges. Include every edge that carries a route of any type:

```txt
edge["x-dialogue"].route.type == "choice" || edge["x-dialogue"].route.type == "unbound"
```

For `choice` routes, key by `choiceId`/`outcome`. For `unbound` routes (which originate from routing points with ambiguous or no incoming color), treat them as valid transitions when resolving router flow. Do NOT silently drop `unbound` edges — they are real route lines produced by the editor.

Edges with `route.type == "broken"` or `"unknown"` are validation errors (see "Editor-only Route Types") — record them in the import error log and skip; do not produce a resolved transition for them.

5. Resolve router nodes in route targets.

6. Validate:
   - `metadata.startNode` exists and is a frame or resolves to a frame.
   - All `speakerId` values exist in characters, unless empty.
   - All choice route `choiceId` values exist on their source frame.
   - All stat ids exist in stats.
   - All property ids exist in properties.
   - All trigger ids exist in triggers.
   - Route points have no more than one outgoing edge.

7. Produce Unity runtime assets/classes.

## Runtime Choice Selection

Characters are not inherently player/NPC. Runtime decides control mode.

Suggested model:

```ts
type DialogueCharacterControlMode = "manual" | "randomAvailable"

interface DialogueCharacterRuntimeState {
  characterId: string
  controlMode: DialogueCharacterControlMode
  stats: Record<string, number>
  inventory: { id: string, quantity?: number }[]
  properties?: Record<string, string | number | boolean>
}
```

If actor is manual:

1. Evaluate each choice availability.
2. Show available choices.
3. Optionally hide unavailable choices when `hideWhenUnavailable` is true.

If actor is randomAvailable:

1. Evaluate each choice availability.
2. Pick random from available choices.

Route outcome:

```txt
if choice checks/conditions pass:
  use success edge
else:
  use failure edge
```

If no matching edge exists:

- If outcome is failure and no failure edge exists, stay terminal or fallback according to game design.
- If success edge missing, treat as terminal/error.

## Notes For Unity Agent

- Ignore all visual-only canvas fields except for optional debug layout.
- Do not rely on edge color, dashed style, labels, or visual route ports.
- The authoritative dialogue data is `x-dialogue`.
- `node.text` is the dialogue line text.
- `x-dialogue.frame.choices` is the choice list.
- `x-dialogue.frame.actions` is the action list.
- `x-dialogue.route` on edges is the routing metadata.
- Routing point nodes are graph helpers only.
- The editor currently stores one `metadata.endNode`, but Unity can also treat missing outgoing routes as endings.
