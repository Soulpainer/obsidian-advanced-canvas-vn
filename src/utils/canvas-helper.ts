// LLM agent change: trimmed from the upstream CanvasHelper (~460 lines, ~15 methods for
// commands, card menus, control menus, style-attribute popups, bbox math, floating edges) down
// to the three static methods the dialogue extensions actually use, plus the shared MenuOption
// shape. Removed the StyleAttribute import (advanced-styles popups are gone) and BBoxHelper
// (bbox math was only used by deleted features).
import { setIcon, setTooltip } from "obsidian"
import { Canvas } from "src/@types/Canvas"

export interface MenuOption {
  id?: string
  label: string
  icon: string
  callback?: () => void
}

export default class CanvasHelper {
  static createPopupMenuOption(menuOption: MenuOption): HTMLElement {
    /* eslint-disable-next-line obsidianmd/prefer-create-el -- So we can return it */
    const menuOptionElement = activeDocument.createElement('button')
    if (menuOption.id) menuOptionElement.id = menuOption.id
    menuOptionElement.classList.add('clickable-icon')
    setIcon(menuOptionElement, menuOption.icon)
    setTooltip(menuOptionElement, menuOption.label, { placement: 'top' })
    menuOptionElement.addEventListener('click', () => menuOption.callback?.())

    return menuOptionElement
  }

  static addPopupMenuOption(canvas: Canvas, element: HTMLElement, index = -1) {
    const popupMenuEl = canvas?.menu?.menuEl
    if (!popupMenuEl) return

    if (element.id) {
      const optionToReplace = popupMenuEl.querySelector(`#${element.id}`)
      if (optionToReplace && index === -1) index = Array.from(popupMenuEl.children).indexOf(optionToReplace) - 1
      optionToReplace?.remove()
    }

    const sisterElement = index >= 0 ? popupMenuEl.children[index] : popupMenuEl.children[popupMenuEl.children.length + index]
    popupMenuEl.insertAfter(element, sisterElement!)
  }

  static createDropdownOptionElement(menuOption: MenuOption): HTMLElement {
    /* eslint-disable-next-line obsidianmd/prefer-create-el -- So we can return it */
    const menuDropdownOptionElement = activeDocument.createElement('div')
    menuDropdownOptionElement.classList.add('menu-item')
    menuDropdownOptionElement.classList.add('tappable')

    // Add icon
    const iconElement = menuDropdownOptionElement.createDiv()
    iconElement.classList.add('menu-item-icon')
    setIcon(iconElement, menuOption.icon)

    // Add label
    const labelElement = menuDropdownOptionElement.createDiv()
    labelElement.classList.add('menu-item-title')
    labelElement.textContent = menuOption.label

    // Add hover effect
    menuDropdownOptionElement.addEventListener('pointerenter', () => {
      menuDropdownOptionElement.classList.add('selected')
    })

    menuDropdownOptionElement.addEventListener('pointerleave', () => {
      menuDropdownOptionElement.classList.remove('selected')
    })

    // Add click event
    menuDropdownOptionElement.addEventListener('click', () => {
      menuOption.callback?.()
    })

    return menuDropdownOptionElement
  }
}
