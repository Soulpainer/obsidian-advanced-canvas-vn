export interface DialogueStatDefinition {
  id: string
  name: string
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

export interface DialogueCharacterDefinition {
  id: string
  name: string
  portrait?: string
  color?: string
  description?: string
}

export interface DialogueNodeData {
  frame?: DialogueFrameData
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

export interface DialogueEdgeData {
  answer?: DialogueAnswerData
  route?: DialogueFailureRouteData
}

export interface DialogueFrameData {
  frameId: string
  speakerId?: string
}

export interface DialogueFrameEditorValue extends DialogueFrameData {
  text: string
}

export interface DialogueNodeData {
  frame?: DialogueFrameData
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

export type DialogueRouteType = "failure"

export interface DialogueFailureRouteData {
  type: DialogueRouteType
  answerId: string
  statId?: string
}

export interface DialogueRouteData {
  route?: DialogueFailureRouteData
}