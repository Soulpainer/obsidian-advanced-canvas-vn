import {
  DialogueAnswerConditionItem,
  DialogueCharacterRuntimeState,
  DialogueChoiceData,
} from "src/@types/DialogueCanvas"

// LLM agent change: player and NPC dialogue actors use the same choice filtering; only selection mode differs.
export default class DialogueChoiceSelector {
  static getAvailableChoices(
    choices: DialogueChoiceData[],
    actor: DialogueCharacterRuntimeState
  ): DialogueChoiceData[] {
    return choices.filter(choice => this.isChoiceAvailable(choice, actor))
  }

  static selectChoice(
    choices: DialogueChoiceData[],
    actor: DialogueCharacterRuntimeState,
    manualChoiceId?: string
  ): DialogueChoiceData | undefined {
    const availableChoices = this.getAvailableChoices(choices, actor)

    if (actor.controlMode === "manual") {
      return availableChoices.find(choice => choice.choiceId === manualChoiceId)
    }

    return this.selectRandomChoice(availableChoices)
  }

  private static isChoiceAvailable(
    choice: DialogueChoiceData,
    actor: DialogueCharacterRuntimeState
  ): boolean {
    return (
      this.checkStats(choice, actor) &&
      this.checkConditions(choice, actor)
    )
  }

  private static checkStats(
    choice: DialogueChoiceData,
    actor: DialogueCharacterRuntimeState
  ): boolean {
    const checks = choice.checks

    if (!checks || checks.items.length === 0) {
      return true
    }

    const results = checks.items.map(item => {
      return (actor.stats[item.statId] ?? 0) >= item.threshold
    })

    return checks.mode === "any"
      ? results.some(Boolean)
      : results.every(Boolean)
  }

  private static checkConditions(
    choice: DialogueChoiceData,
    actor: DialogueCharacterRuntimeState
  ): boolean {
    const conditions = choice.conditions

    if (!conditions || conditions.items.length === 0) {
      return true
    }

    const results = conditions.items.map(item => this.checkCondition(item, actor))

    return conditions.mode === "any"
      ? results.some(Boolean)
      : results.every(Boolean)
  }

  private static checkCondition(
    item: DialogueAnswerConditionItem,
    actor: DialogueCharacterRuntimeState
  ): boolean {
    const actualValue = item.source === "stat"
      ? actor.stats[item.id]
      : actor.properties?.[item.id]

    switch (item.op) {
      case "exists":
        return actualValue !== undefined
      case "notExists":
        return actualValue === undefined
      case "==":
        return actualValue === item.value
      case "!=":
        return actualValue !== item.value
      case ">":
        return Number(actualValue) > Number(item.value)
      case ">=":
        return Number(actualValue) >= Number(item.value)
      case "<":
        return Number(actualValue) < Number(item.value)
      case "<=":
        return Number(actualValue) <= Number(item.value)
      default:
        return false
    }
  }

  private static selectRandomChoice(choices: DialogueChoiceData[]): DialogueChoiceData | undefined {
    if (choices.length === 0) {
      return undefined
    }

    return choices[Math.floor(Math.random() * choices.length)]
  }
}
