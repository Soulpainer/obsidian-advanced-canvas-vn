export interface DialogueStatDefinition {
  id: string
  name: string
  group?: string
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

export interface DialogueAnswerData {
  answerId: string
  text: string
  hideWhenUnavailable?: boolean
  checks?: DialogueAnswerChecksData
}

export interface DialogueEdgeData {
  answer?: DialogueAnswerData
}