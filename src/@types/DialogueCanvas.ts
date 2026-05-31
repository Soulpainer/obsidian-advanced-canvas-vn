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

export interface DialogueAnswerData {
  answerId: string
  text: string
  hideWhenUnavailable?: boolean
  checks?: DialogueAnswerChecksData
  conditions?: DialogueAnswerConditionsData
}

export interface DialogueEdgeData {
  answer?: DialogueAnswerData
}