// LLM agent change: shared route-color resolution. Used by both the choice-route extension (edge
// coloring) and the router extension (node coloring), so the color of a route is computed in ONE
// place. This prevents the two extensions from drifting (e.g. node color not matching its edges).

import {
  DialogueChoiceData,
  DialogueChoiceRouteOutcome,
  DialogueFailureRouteData,
} from "src/@types/DialogueCanvas"

/**
 * Resolve the choice index of a route against the source node's choices. Returns the index, or -1
 * if the choiceId can't be found (and no cached index is available). Mirrors the logic that used to
 * be inline in renderRouteEdge / applyOutgoingRoute.
 */
export function resolveChoiceIndex(
  route: { choiceId?: string; choiceIndex?: number },
  choices: DialogueChoiceData[]
): number {
  if (!route.choiceId) {
    return route.choiceIndex !== undefined ? route.choiceIndex : -1
  }
  const index = choices.findIndex(choice => choice.choiceId === route.choiceId)
  if (index >= 0) {
    return index
  }
  // Fall back to a cached choiceIndex (set by saveRoute / a prior cascade) when the source has no
  // choices to look up (e.g. the fromNode is a router).
  return route.choiceIndex !== undefined ? route.choiceIndex : -1
}

/**
 * The CSS color string for a route, as used by renderRouteEdge and now by router-node coloring.
 * choiceIndex < 0 means "unbound" (neutral). This is the single source of truth for route colors.
 */
export function getRouteColorCss(choiceIndex: number, outcome: DialogueChoiceRouteOutcome): string {
  // LLM agent change: choiceIndex < 0 means "unbound" — a route edge not tied to a specific choice
  // (e.g. leaving a router with zero/multiple incoming routes). Returns the neutral unbound color.
  if (choiceIndex < 0) {
    return "var(--dialogue-route-unbound-color)"
  }

  const colorIndex = choiceIndex % 8 + 1

  if (outcome === "failure") {
    return `var(--dialogue-choice-failure-color-${colorIndex})`
  }

  return `var(--dialogue-choice-color-${colorIndex})`
}

/**
 * Resolve a route of ANY type to its CSS color string. Choice routes compute a palette index from
 * the source's choices (falling back to a cached choiceIndex); unbound/broken/unknown routes map
 * to their themed variable. This is the unified entry point — used by edge rendering and node
 * coloring alike, so a node and its edges always agree on color.
 *
 * `route` is a DialogueFailureRouteData (the base route shape, which carries `type` plus optional
 * choiceId/outcome/choiceIndex). We narrow on `route.type`.
 */
export function routeToColorCss(
  route: DialogueFailureRouteData,
  sourceChoices: DialogueChoiceData[]
): string {
  if (route.type === "unknown") {
    return "var(--dialogue-route-unknown-color)"
  }
  if (route.type === "broken") {
    return "var(--dialogue-route-broken-color)"
  }
  if (route.type === "unbound") {
    return getRouteColorCss(-1, "success")
  }
  // choice (or failure legacy) — resolve palette index
  const choiceIndex = resolveChoiceIndex(route, sourceChoices)
  if (choiceIndex < 0) {
    // Unresolved choice — defensive (should already be persisted as broken upstream).
    return "var(--dialogue-route-broken-color)"
  }
  // outcome may be undefined on legacy data; default to success.
  const outcome = route.outcome ?? "success"
  return getRouteColorCss(choiceIndex, outcome)
}

/**
 * Resolve a CSS color expression (which may reference CSS variables like var(--...)) to a concrete
 * rgb/rgba string by probing the DOM. Needed because SVG `stroke` and inline `style` don't always
 * resolve var() references consistently across Obsidian versions.
 */
export function resolveCssColor(cssColor: string): string {
  const probe = activeDocument.createElement("span")
  probe.style.color = cssColor
  activeDocument.body.appendChild(probe)
  const resolvedColor = getComputedStyle(probe).color
  probe.remove()

  return resolvedColor || cssColor
}
