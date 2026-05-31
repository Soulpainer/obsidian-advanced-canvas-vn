export interface DialogueAnswerData {
  answerId: string
  text: string
  hideWhenUnavailable?: boolean
}

export interface DialogueEdgeData {
  answer?: DialogueAnswerData
}