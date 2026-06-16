export interface DialogueStatDefinition {
  id: string
  name: string
  icon?: string
  group?: string
  description?: string
}

export type DialoguePropertyType = "bool" | "int" | "string"

export interface DialoguePropertyDefinition {
  id: string
  name: string
  type: DialoguePropertyType
  group?: string
  defaultValue?: string
  description?: string
}

export interface DialogueTriggerDefinition {
  id: string
  name: string
  description?: string
}

export type DialogueStatValueMap = Record<string, number>

export interface DialogueInventoryItem {
  id: string
  quantity?: number
}

export interface DialogueCharacterDefinition {
  id: string
  name: string
  portrait?: string
  color?: string
  stats?: DialogueStatValueMap
  inventory?: DialogueInventoryItem[]
  description?: string
}

// LLM agent change: player and NPC characters share data; control mode decides who picks choices.
export type DialogueCharacterControlMode = "manual" | "randomAvailable"

export interface DialogueCharacterRuntimeState {
  characterId: string
  controlMode: DialogueCharacterControlMode
  stats: DialogueStatValueMap
  inventory: DialogueInventoryItem[]
  properties?: Record<string, DialogueConditionValue>
}

export type DialogueChecksMode = "all" | "any"

export interface DialogueAnswerCheckItem {
  statId: string
  threshold: number
}

export interface DialogueAnswerChecksData {
  mode: DialogueChecksMode
  items: DialogueAnswerCheckItem[]
}

export type DialogueConditionMode = "all" | "any"
export type DialogueConditionSource = "stat" | "property"

export type DialogueConditionOperator =
  | "exists"
  | "notExists"
  | "=="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="

export type DialogueConditionValue = string | number | boolean

export interface DialogueAnswerConditionItem {
  source: DialogueConditionSource
  id: string
  op: DialogueConditionOperator
  value?: DialogueConditionValue
}

export interface DialogueAnswerConditionsData {
  mode: DialogueConditionMode
  items: DialogueAnswerConditionItem[]
}

// LLM agent change: choices belong to a dialogue frame node, not to canvas edges.
export interface DialogueChoiceData {
  choiceId: string
  text: string
  hideWhenUnavailable?: boolean
  checks?: DialogueAnswerChecksData
  conditions?: DialogueAnswerConditionsData
}

export type DialogueFrameActionOperation = "add" | "subtract" | "set"
export type DialogueFrameActionType = "trigger" | "globalProperty" | "characterStat" | "characterInventory"
export type DialogueFrameActionNumberType = "integer" | "float"

export interface DialogueFrameActionRangeValue {
  mode: "range"
  min: number
  max: number
  numberType: DialogueFrameActionNumberType
}

export type DialogueFrameActionValue = DialogueConditionValue | DialogueFrameActionRangeValue
export type DialogueFrameActionNumericValue = number | DialogueFrameActionRangeValue

export interface DialogueFrameTriggerActionData {
  type: "trigger"
  triggerId: string
}

export interface DialogueFrameGlobalPropertyActionData {
  type: "globalProperty"
  propertyId: string
  operation: DialogueFrameActionOperation
  value: DialogueFrameActionValue
}

export interface DialogueFrameCharacterStatActionData {
  type: "characterStat"
  characterId: string
  statId: string
  operation: DialogueFrameActionOperation
  value: DialogueFrameActionNumericValue
}

export interface DialogueFrameCharacterInventoryActionData {
  type: "characterInventory"
  characterId: string
  itemId: string
  operation: DialogueFrameActionOperation
  quantity: DialogueFrameActionNumericValue
}

export type DialogueFrameActionData =
  | DialogueFrameTriggerActionData
  | DialogueFrameGlobalPropertyActionData
  | DialogueFrameCharacterStatActionData
  | DialogueFrameCharacterInventoryActionData

export interface DialogueEdgeData {
  answer?: DialogueAnswerData
  route?: DialogueFailureRouteData
}

export interface DialogueFrameData {
  frameId: string
  speakerId?: string
  choices?: DialogueChoiceData[]
  actions?: DialogueFrameActionData[]
}

export interface DialogueFrameEditorValue extends DialogueFrameData {
  text: string
}

export interface DialogueRouterData {
  type: "point"
}

export interface DialogueNodeData {
  frame?: DialogueFrameData
  router?: DialogueRouterData
}

export interface DialogueAnswerData {
  answerId: string
  hideWhenUnavailable?: boolean
  checks?: DialogueAnswerChecksData
  conditions?: DialogueAnswerConditionsData
}

export interface DialogueAnswerEditorValue extends DialogueAnswerData {
  text: string
}

export type DialogueRouteType = "failure" | "choice"
export type DialogueChoiceRouteOutcome = "success" | "failure"

export interface DialogueFailureRouteData {
  type: DialogueRouteType
  answerId?: string
  choiceId?: string
  outcome?: DialogueChoiceRouteOutcome
  statId?: string
}

export interface DialogueRouteData {
  route?: DialogueFailureRouteData
}
