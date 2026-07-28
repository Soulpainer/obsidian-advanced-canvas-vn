# Agent Handoff

> LLM agent change: this handoff document was prepared by Codex, an LLM agent, on 2026-07-26 for the next development agent.

## Зачем этот документ

Это форк `obsidian-advanced-canvas-vn`, который сейчас превращается в авторский редактор dialogue graph для визуальной новеллы/Unity-runtime. Основная работа велась вокруг Obsidian Canvas: фреймы диалога, choices, checks/conditions, actions, route points и экспортируемый JSON-формат через `x-dialogue`.

Важное правило из [AGENTS.md](../AGENTS.md): любые изменения LLM-агента должны быть явно помечены. В существующем коде это чаще всего сделано комментариями `LLM agent change: ...`. Для новых коммитов безопасный вариант: добавить префикс вроде `[LLM agent]` в commit message и/или оставлять точечные комментарии рядом с нетривиальными LLM-правками.

## Текущее состояние репозитория

На момент подготовки этого handoff:

- `git status --short` был чистым.
- Обычный `git status` в sandbox падает из-за dubious ownership. Используй:

```powershell
git -c safe.directory=C:/Users/BARD/Projects/obsidian-advanced-canvas-vn status --short
```

- Последние коммиты по смыслу: `unity instuctions`, `collapse/expand`, `actions`, `route joints`, `choises`, `dialog`, `character badge`, `conditions`, `checks`, `dialogue data`.

## Главная архитектура

Точка входа: [src/main.ts](../src/main.ts).

Сейчас в `CANVAS_EXTENSIONS` подключены только тихая canvas-инфраструктура и dialogue UI:

- `MetadataCanvasExtension`
- dataset exposers: canvas metadata, wrapper, node, edge, node interaction
- `DialogueFrameCanvasExtension`
- `DialogueRouterCanvasExtension`
- `DialogueChoiceRouteCanvasExtension`

Важно: [src/canvas-extensions/dialogue-answer-canvas-extension.ts](../src/canvas-extensions/dialogue-answer-canvas-extension.ts) и [src/canvas-extensions/dialogue-test-canvas-extension.ts](../src/canvas-extensions/dialogue-test-canvas-extension.ts) существуют, но сейчас не зарегистрированы в [src/main.ts](../src/main.ts). `DialogueAnswerCanvasExtension` выглядит как более старый edge-answer подход и частично конфликтует с новым решением, где choices живут на frame node.

Основные типы: [src/@types/DialogueCanvas.ts](../src/@types/DialogueCanvas.ts).

Формат для Unity/runtime описан отдельно: [docs/unity-dialogue-data-format.md](unity-dialogue-data-format.md).

## Модель данных

Dialogue-данные живут в кастомном поле `x-dialogue`.

У canvas metadata используются:

- `metadata.startNode`
- `metadata.endNode`

У node:

- `node["x-dialogue"].frame` - диалоговый фрейм.
- `node["x-dialogue"].router` - прозрачная route point нода.

У frame сейчас есть:

- `frameId`
- `speakerId`
- `choices`
- `actions`

Текст реплики хранится только в `node.text`. Старое поле вида `x-dialogue.frame.text` больше не считается источником истины.

У edge:

- `edge["x-dialogue"].route.type === "choice"` - основной новый маршрут choice.
- route содержит `choiceId` и `outcome: "success" | "failure"`.
- Старые `edge["x-dialogue"].answer` и `route.type === "failure"` ещё есть в типах/старом extension, но новый активный путь должен опираться на frame choices + choice routes.

## Что уже сделано

[src/canvas-extensions/dialogue-router-canvas-extension.ts](../src/canvas-extensions/dialogue-router-canvas-extension.ts):

- Добавляет пункты context menu: `Add dialogue frame` и `Add dialogue route point`.
- Создаёт dialogue frame как text-node `360x220` с `x-dialogue.frame`.
- Создаёт route point как маленькую `28x28` transparent helper node с `x-dialogue.router.type = "point"`.
- Для route point разрешает только один outgoing edge, лишние удаляются.
- Настраивает CSS/interaction так, чтобы selected route point был drag-only, а unselected route point сохранял edge handles.

[src/canvas-extensions/dialogue-frame-canvas-extension.ts](../src/canvas-extensions/dialogue-frame-canvas-extension.ts):

- Открывает modal editor при double-click/native edit request вместо inline canvas editing.
- Умеет ставить/unset `startNode` и `endNode`.
- Рендерит character header: portrait, initials или fallback mark.
- Рендерит текст frame через отдельный overlay, а native markdown content скрывает.
- Рендерит choices внутри node как passive rows.
- Показывает stat badges для checks/conditions.
- Показывает `ACT n` indicator, если у frame есть actions.
- Поддерживает min-size для frame, чтобы choices/header не ломали карточку.

[src/modals/edit-dialogue-frame-modal.ts](../src/modals/edit-dialogue-frame-modal.ts):

- Редактирует `frameId`, `speakerId`, `text`.
- Редактирует choices внутри frame.
- У choices есть text, `hideWhenUnavailable`, checks и conditions.
- При сохранении choices перенумеровываются в `1..N`. Это важно: route binding завязан на `choiceId`, поэтому reorder/remove может инвалидировать старые edge routes.
- Редактирует frame actions: trigger, global property, character stat, character inventory.
- Для action values поддержаны fixed value и random range.
- Есть collapse/expand для choices/actions.

[src/canvas-extensions/dialogue-choice-route-canvas-extension.ts](../src/canvas-extensions/dialogue-choice-route-canvas-extension.ts):

- В popup menu edge добавляет `Bind Choice Route`.
- В popup menu frame node добавляет `Add Linked Choice Frame`, если у frame есть choices.
- Привязывает edge к `choiceId + outcome`.
- Success/failure routes получают разные anchors/colors; failure edge визуально dashed.
- Перерисовывает route path после native edge render, node move/resize, dialogue frame render и pointer drag.
- Прячет native edge label для choice-bound edges.

[src/patchers/canvas-patcher.ts](../src/patchers/canvas-patcher.ts):

- Перехватывает `setIsEditing` для dialogue frame: вместо inline editing триггерит `advanced-canvas:dialogue-frame-edit-requested`.
- После native edge render триггерит `advanced-canvas:edge-rendered:after`, на это опирается route renderer.

[src/canvas-extensions/advanced-styles/edge-styles.ts](../src/canvas-extensions/advanced-styles/edge-styles.ts):

- Пропускает `x-dialogue.route.type === "choice"`, чтобы advanced edge styling не вступал в рекурсию с кастомным renderer.

[src/canvas-extensions/dataset-exposers/canvas-metadata-exposer.ts](../src/canvas-extensions/dataset-exposers/canvas-metadata-exposer.ts):

- Кроме `data-is-start-node` теперь выставляет `data-is-end-node`.

Support data loaders:

- [src/utils/dialogue-characters-loader.ts](../src/utils/dialogue-characters-loader.ts) читает `Dialogue/Characters.md`.
- [src/utils/dialogue-stats-loader.ts](../src/utils/dialogue-stats-loader.ts) читает `Dialogue/Stats.md`.
- [src/utils/dialogue-properties-loader.ts](../src/utils/dialogue-properties-loader.ts) читает `Dialogue/Properties.md`.
- [src/utils/dialogue-triggers-loader.ts](../src/utils/dialogue-triggers-loader.ts) читает `Dialogue/Triggers.md`.

[src/utils/dialogue-choice-selector.ts](../src/utils/dialogue-choice-selector.ts):

- Утилита runtime-выбора choice: фильтрует по checks/conditions.
- `manual` берёт указанное `choiceId`, `randomAvailable` выбирает случайный available choice.

## Support Markdown files в vault

Редактор ожидает опциональные файлы в vault:

- `Dialogue/Characters.md`
- `Dialogue/Stats.md`
- `Dialogue/Properties.md`
- `Dialogue/Triggers.md`

Каждый loader ищет markdown table с нужными колонками. Детальный формат уже описан в [docs/unity-dialogue-data-format.md](unity-dialogue-data-format.md).

## Где обосрались / риски

1. `npx tsc --noEmit` сейчас падает. Это самый важный технический долг перед продолжением.

Ключевые ошибки:

- [src/canvas-extensions/dialogue-choice-route-canvas-extension.ts](../src/canvas-extensions/dialogue-choice-route-canvas-extension.ts): `getRouteCanvasColorId()` возвращает plain `string`, а `color` ожидает `CanvasColor`.
- [src/canvas-extensions/dialogue-choice-route-canvas-extension.ts](../src/canvas-extensions/dialogue-choice-route-canvas-extension.ts): `EditDialogueFrameModal` теперь требует `triggers`, но `openFrameModal()` их не загружает и не передаёт.
- [src/canvas-extensions/dialogue-choice-route-canvas-extension.ts](../src/canvas-extensions/dialogue-choice-route-canvas-extension.ts) и [src/canvas-extensions/dialogue-router-canvas-extension.ts](../src/canvas-extensions/dialogue-router-canvas-extension.ts): `node.setData({ text: ... })` ругается, потому что `CanvasNode.getData()` типизирован как `CanvasNodeData`, а не `CanvasTextNodeData | AnyCanvasNodeData`.
- [src/canvas-extensions/dialogue-frame-canvas-extension.ts](../src/canvas-extensions/dialogue-frame-canvas-extension.ts) и [src/canvas-extensions/dialogue-choice-route-canvas-extension.ts](../src/canvas-extensions/dialogue-choice-route-canvas-extension.ts): сохраняются `checks`/`conditions` на `DialogueFrameData`, хотя в типе их уже нет. Это похоже на остаток старой модели.
- [src/canvas-extensions/dialogue-frame-canvas-extension.ts](../src/canvas-extensions/dialogue-frame-canvas-extension.ts): `NodeListOf<Element>` spread и narrowing around `extractColorFromCssValue()` тоже дают TS errors.

2. `npm run build` в текущем sandbox упал до нормальной проверки:

```txt
Cannot read directory "../..": Access is denied.
Could not resolve "./src/styles.scss"
Could not resolve "./src/main.ts"
```

Это может быть sandbox/path issue с esbuild. После исправления TS всё равно нужно перепроверить build в нормальной среде Obsidian/plugin dev.

3. `npm run lint` сейчас падает массово: 417 errors, 2 warnings. Там смешаны старые ошибки проекта и новые dialogue warnings/errors. Не воспринимай lint как точечный индикатор только dialogue-изменений, но dialogue-файлы тоже надо привести в порядок перед релизом.

4. В коде есть mojibake из-за сломанной кодировки.

Примеры:

- Русские комментарии отображаются как `РњРёРЅ...`.
- Emoji/string literals отображаются как `рџЋІ`, `рџ”’`, `вќЊ`, `вњЋ`.
- Это есть и в [src/canvas-extensions/dialogue-answer-canvas-extension.ts](../src/canvas-extensions/dialogue-answer-canvas-extension.ts), и в [src/canvas-extensions/dialogue-frame-canvas-extension.ts](../src/canvas-extensions/dialogue-frame-canvas-extension.ts), и в [docs/unity-dialogue-data-format.md](unity-dialogue-data-format.md).

Не делай массовую замену вслепую. Сначала надо понять, где это только комментарии/доки, а где runtime-visible labels/icons. Особенно опасны `stripLabelPrefixes()` и `buildEdgeLabel()` в legacy answer extension.

5. Choice IDs нестабильны при сохранении.

`EditDialogueFrameModal.getValidChoices()` перенумеровывает choices по порядку. Если у frame уже есть edges с `choiceId`, удаление/перестановка choices может перепривязать маршруты к другому choice. Нужно решить модель: либо choiceId должен быть стабильным semantic id, либо после сохранения надо мигрировать outgoing route edges.

6. Actions не полностью сохранены во всех путях.

Основной `DialogueFrameCanvasExtension.saveDialogueFrame()` сохраняет `actions`, но `DialogueChoiceRouteCanvasExtension.openFrameModal()/saveFrame()` выглядит устаревшим: не передаёт `triggers`, не включает `actions` в `initialValue`, и при save не сохраняет actions. Это надо синхронизировать или удалить дублирующий frame modal path.

7. `DialogueAnswerCanvasExtension` выглядит legacy и не подключён.

Он хранит answer metadata на edges, умеет Edit Answer/Checks/Conditions/Failure Route и строит labels с emoji prefixes. Новая runtime-дока говорит, что choices принадлежат frame nodes, а edges только route. Лучше не включать этот extension без осознанной миграции.

8. Нет автоматических тестов для dialogue parsing/rendering.

Сейчас поведение проверялось в основном через code inspection и команды. Для следующего шага полезны хотя бы unit tests для:

- markdown table loaders;
- `DialogueChoiceSelector`;
- choice id/route migration;
- action value normalization.

## Команды проверки

```powershell
npx tsc --noEmit
npm run build
npm run lint
```

В sandbox `npm run build` может упасть из-за access/path issue, но `npx tsc --noEmit` уже показывает реальные compile errors.

## Что чинить первым

1. Вернуть зелёный `npx tsc --noEmit`.

Самые быстрые правки:

- Передавать `DialogueTriggersLoader.loadTriggers()` в `DialogueChoiceRouteCanvasExtension.openFrameModal()`.
- Убрать `checks`/`conditions` из `DialogueFrameData` save paths или явно вернуть их в тип, если они реально нужны.
- Починить типизацию text node data: импортировать/использовать `CanvasTextNodeData`/`AnyCanvasNodeData` или расширить локальный `CanvasNodeDataWithDialogue` так, чтобы `setData()` принимал `text`.
- Вернуть `CanvasColor` вместо plain `string` для edge colors.
- Заменить spread `NodeListOf` на `Array.from(...)`.

2. Выбрать единственную модель choices/routes.

Рекомендация: новая модель должна быть такой:

- choices живут только в `node["x-dialogue"].frame.choices`;
- edge хранит только route binding: `choiceId + outcome`;
- legacy `answer` extension оставить выключенным или удалить после миграции;
- `choiceId` сделать стабильным и не зависящим от порядка в списке.

3. Синхронизировать creation/edit paths.

Сейчас frame можно редактировать через `DialogueFrameCanvasExtension`, но linked frame создаётся и редактируется через `DialogueChoiceRouteCanvasExtension.openFrameModal()`. Лучше переиспользовать один путь/событие, чтобы не расходились `triggers/actions/focus/onClose`.

4. Аккуратно разобрать mojibake.

Сначала восстановить source encoding или заменить только безопасные user-visible strings. Не забыть, что AGENTS требует отмечать LLM-изменения.

5. Проверить UX в Obsidian.

Нужно руками открыть canvas и пройти сценарии:

- add dialogue frame;
- edit frame by double-click;
- add choices/checks/conditions/actions;
- add linked choice frame;
- bind existing edge to choice success/failure;
- move/resize source and target nodes;
- create route point and verify one outgoing edge;
- save/reopen canvas and verify rendered anchors/labels.

## Где смотреть при продолжении

Для runtime/schema:

- [src/@types/DialogueCanvas.ts](../src/@types/DialogueCanvas.ts)
- [docs/unity-dialogue-data-format.md](unity-dialogue-data-format.md)

Для frame UI:

- [src/canvas-extensions/dialogue-frame-canvas-extension.ts](../src/canvas-extensions/dialogue-frame-canvas-extension.ts)
- [src/modals/edit-dialogue-frame-modal.ts](../src/modals/edit-dialogue-frame-modal.ts)
- [src/styles.scss](../src/styles.scss)

Для route UI:

- [src/canvas-extensions/dialogue-choice-route-canvas-extension.ts](../src/canvas-extensions/dialogue-choice-route-canvas-extension.ts)
- [src/canvas-extensions/dialogue-router-canvas-extension.ts](../src/canvas-extensions/dialogue-router-canvas-extension.ts)
- [src/patchers/canvas-patcher.ts](../src/patchers/canvas-patcher.ts)

Для external data:

- [src/utils/dialogue-characters-loader.ts](../src/utils/dialogue-characters-loader.ts)
- [src/utils/dialogue-stats-loader.ts](../src/utils/dialogue-stats-loader.ts)
- [src/utils/dialogue-properties-loader.ts](../src/utils/dialogue-properties-loader.ts)
- [src/utils/dialogue-triggers-loader.ts](../src/utils/dialogue-triggers-loader.ts)

## Ментальная модель для следующего агента

Думай об этом не как о generic canvas plugin, а как о dialogue authoring layer поверх Obsidian Canvas.

Canvas остаётся visual graph editor. `x-dialogue` - authoritative game data. DOM/CSS overlays нужны только для удобного авторинга: headers, choices, ports, colored routes. Unity/runtime должен читать JSON и markdown tables, а не пытаться восстановить смысл из canvas colors/labels/DOM.

Если есть сомнение между красивым canvas UX и стабильностью данных, выбирай стабильность данных.
