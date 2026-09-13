<p align="center">
  <a href="https://www.patreon.com/c/shatteredcodex?utm_source=sc-conditional-ae&utm_medium=github&utm_campaign=support_readme">
    <img src="https://i.imgur.com/9kf3oWy.png" alt="Shattered Codex" width="200" height="200" />
  </a>
</p>

# SC - Conditional AE

Give your D&D 5e Active Effects conditions, activation rolls, and macro automation in Foundry VTT.

[![Wiki](https://img.shields.io/badge/Wiki-Documentation-1f6feb?logo=bookstack&logoColor=white&style=for-the-badge)](https://wiki.shattered-codex.com/modules/sc-conditional-ae)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white&style=for-the-badge)](https://discord.gg/nZJVbbkMTk)
[![Support on Patreon](https://img.shields.io/badge/Patreon-Shattered%20Codex-FF424D?logo=patreon&logoColor=white&style=for-the-badge)](https://www.patreon.com/c/shatteredcodex?utm_source=sc-conditional-ae&utm_medium=github&utm_campaign=support_readme)

![Foundry VTT 13-14](https://img.shields.io/badge/Foundry%20VTT-v13%20%7C%20v14-orange?logo=foundry-vtt&logoColor=white&style=for-the-badge)
![System: dnd5e](https://img.shields.io/badge/System-dnd5e-blue?style=for-the-badge)
[![libWrapper Recommended](https://img.shields.io/badge/libWrapper-Recommended-8A2BE2?style=for-the-badge)](https://github.com/ruipin/fvtt-lib-wrapper)
[![Downloads](https://img.shields.io/github/downloads/Shattered-Codex/sc-conditional-ae/total?style=for-the-badge)](https://github.com/Shattered-Codex/sc-conditional-ae/releases)

## At a glance

| Build an effect that… | Use… |
|---|---|
| Applies only below half HP, while an item is equipped, or in bright light | JavaScript conditions and the **Condition** tab |
| Uses D&D 5e native filters alongside JavaScript | The **Native Conditions**, **Advanced Conditions**, and **Evaluation** tabs in D&D 5e 6.x |
| Rolls a bonus or penalty when it becomes active | A **Formula** on an eligible change |
| Runs automation when it turns on or off | A `cae.macro.execute` change |
| Replaces an existing target effect or stacks another copy | **When applied to a target** |

<p align="center">
  <a href="https://i.imgur.com/yWfmF8z.png">
    <img src="https://i.imgur.com/yWfmF8z.png" alt="Condition tab showing separate status rows for the whole effect and its AC Bonus change, plus suppression, badge, and target application settings" width="557" />
  </a>
</p>

*The Condition tab in D&D 5e 6.x. Filter buttons open the conditions for the whole effect or an individual change.*

**On this page:** [Installation](#installation) · [Conditions](#conditions) · [Formulas](#formulas) · [Macros](#macros) · [Target application](#target-application) · [Settings](#settings) · [Compatibility](#compatibility) · [Troubleshooting](#troubleshooting) · [API](#public-api) · [Support](#support)

## Installation

| Requirement | Supported configuration |
|---|---|
| Foundry VTT | v13 or v14 |
| Game system | D&D 5e (`dnd5e`), minimum version 4.0.0 |
| Recommended helper | [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper) |
| Optional integration | DAE |

Use a D&D 5e release compatible with your Foundry version. The native filter builder and per-change conditions described below require D&D 5e 6.x; earlier system versions use the effect-wide Condition editor.

1. In Foundry's Setup screen, open **Add-on Modules → Install Module**.
2. Paste the following manifest URL and install the module.
3. Enable **SC - Conditional AE** in your world's module management window.
4. Open **Configure Settings → Module Settings → SC - Conditional AE → Open settings** to choose the features you want.

```text
https://github.com/Shattered-Codex/sc-conditional-ae/releases/latest/download/module.json
```

**Show condition tab** and **Enable formula fields** are enabled by default. Changing either setting requires a reload.

## Conditions

### Create your first condition

1. Open an Active Effect and select **Condition**.
2. In D&D 5e 6.x, click the filter button on the **General** row, then open **Advanced Conditions**. In earlier versions, use the editor directly in the Condition tab.
3. Enter a condition. For example, to require at least 1 HP:

   ```js
   return (actor?.system?.attributes?.hp?.value ?? 0) > 0;
   ```

4. Check **Evaluation** in the 6.x editor, or **Current evaluation** in the earlier editor.
5. Click **Submit Changes** to save. Save the effect sheet as needed for its other fields.

A single expression is also valid. Scripts with statements such as `const` or `if` should finish with `return`. Conditions must be synchronous; returning a Promise is invalid.

### Native and advanced conditions in D&D 5e 6.x

Open the editor from a native filter button or a condition-status row. It has three tabs:

| Tab | What you do there |
|---|---|
| **Native Conditions** | Build a native D&D 5e filter using attributes, operators, values, and nested groups. Switch between **Builder** and **JSON**. |
| **Advanced Conditions** | Write JavaScript and use **Insert variable** to browse the available context. |
| **Evaluation** | Check native and JavaScript results together. When editing a change, see its conditions alongside the effect-wide conditions. |

| Native filter builder | JSON view |
|---|---|
| [![Native Conditions builder with an HP comparison](https://i.imgur.com/JvUMlkB.png)](https://i.imgur.com/JvUMlkB.png) | [![JSON view of the native HP filter](https://i.imgur.com/qb4DXKm.png)](https://i.imgur.com/qb4DXKm.png) |

| JavaScript editor | Combined evaluation |
|---|---|
| [![Advanced Conditions editor with Insert variable control](https://i.imgur.com/yickrWK.png)](https://i.imgur.com/yickrWK.png) | [![Evaluation showing met general conditions and an unmet native condition on the selected change](https://i.imgur.com/IhGWZ4W.png)](https://i.imgur.com/IhGWZ4W.png) |

*Click any screenshot to open it at full size. All nine screenshots are also available in the [Imgur album](https://imgur.com/a/MzZ37IS).*

Native filters use the system's evaluation data; JavaScript conditions use the variables listed below. In the builder, values accept JSON literals: `5` is a number, `"5"` is text, and `["fire", "cold"]` is an array. Invalid or unsupported builder input remains available in the JSON editor for correction.

**Submit Changes** saves the native and advanced conditions together, including when the editor was opened from an individual change. Other unsaved fields in the change dialog still belong to that dialog. Switching a populated group to **NOT** keeps its conditions nested inside the negation; adding a child to a populated **NOT** group preserves the existing child.

An effect-wide condition controls the whole effect. A change-specific condition controls only that operation. Applicable native and advanced conditions must all pass. Native change types that skip conditions retain that D&D 5e behavior.

### Read the result

| State | Meaning |
|---|---|
| **Met** | The condition passes. An empty condition adds no restriction. |
| **Not met** | The condition currently prevents the effect or change from applying. |
| **Invalid or errored** | The condition cannot be evaluated successfully. Check its code and context. |
| **Depends on roll context** | The filter needs data such as `roll.*`, which is available during the relevant roll. |

For effect-wide JavaScript conditions, **When the condition is not met** chooses between **Suppress changes (default)** and **Disable Active Effect**. Suppression keeps the effect enabled while preventing its changes. The disable option synchronizes the effect's disabled state and re-enables it when the condition passes again.

Use **Condition badge label** to explain an unmet condition on effect lists. Leave it blank for the default label.

### Copyable examples

**At or below half HP:**

```js
const hp = actor?.system?.attributes?.hp;
return (hp?.max ?? 0) > 0 && hp.value <= hp.max / 2;
```

**Only while the owning item is equipped:**

```js
return item?.system?.equipped === true;
```

**Only in bright light:**

```js
return lightLevel === "bright";
```

**In bright or dim light:**

```js
return ["bright", "dim"].includes(lightLevel);
```

<details>
<summary>Available JavaScript variables</summary>

| Variable | Meaning |
|---|---|
| `effect` | The Active Effect being evaluated |
| `change`, `changeId` | The selected change and its stable ID; `null` for an effect-wide condition |
| `actor`, `targetActor` | The affected actor; `targetActor` is an alias, not the current selected target |
| `token` | The actor's synthetic token, or its first active token on the current canvas |
| `lightLevel` | `"bright"`, `"dim"`, `"dark"`, or `null` when no canvas token can be resolved |
| `item` | The owning or origin item, when available |
| `origin`, `originActor` | The resolved origin document and associated actor, when available |
| `user` | The current Foundry user |
| `rollData` | The actor's roll data, resolved when needed |
| `source` | A cloned snapshot of the effect data |
| `getProperty`, `hasProperty`, `deepClone` | Foundry utility helpers |
| `game` | The Foundry `game` object |

</details>

<details>
<summary>Refresh timing, lighting, and linked tokens</summary>

Actor, item, and effect updates can refresh conditions. Conditions that reference `token` are refreshed when the token moves. Conditions that reference `lightLevel` are checked after canvas lighting refreshes; the actor is reset only when availability changes.

Spatial conditions use the current client's rendered canvas. For a linked actor with multiple tokens, the first active token is used. These conditions always suppress changes, even if **Disable Active Effect** is selected, so one scene's lighting does not persist a disabled state for every linked token.

Exposing `game` or `user` does not make every change to them a refresh trigger. In particular, conditions based on current target selection can become stale. Use an activity-time condition for rules that depend on the target of a particular attack or action.

</details>

## Formulas

Use a formula when an eligible Active Effect change should receive a rolled value on activation. The result is stored in the normal **Value** field.

1. Enable **Enable formula fields** in module settings.
2. Add a normal attribute change, such as an **Add** bonus.
3. Enter a **Formula**, or open its editor to browse variables and preview the result or dice range.
4. Save the formula and the change fields, then activate the effect.

For example:

```text
Attribute Key: system.attributes.ac.bonus
Type / Mode: Add
Value: 0
Formula: 1d4
```

| Formula on a D&D 5e 6.x change | Formula editor and preview |
|---|---|
| [![Change dialog with an AC bonus, Formula field, and Change Conditions](https://i.imgur.com/VkvEMtI.png)](https://i.imgur.com/VkvEMtI.png) | [![Formula editor with a dice formula, actor variables, and a result range preview](https://i.imgur.com/z7zT5WB.png)](https://i.imgur.com/z7zT5WB.png) |

Formulas roll when an effect activates, is re-enabled, or becomes available after its condition changes. An active non-GM owner of the actor is preferred as the responsible user; an active GM is the fallback. Eligible formulas respect effect-wide and per-change conditions.

By default, rolls happen immediately. Enable **Post formula roll chat card** to request rolls through chat buttons instead. Supported actor and item effect lists also provide a d20 control for rolling available formulas.

### Choose a formula field style

The **Formula field style** preference controls formula editing on change-row sheets. D&D 5e 6.x's separate change dialog provides its own Formula field and editor button.

| Style | Presentation |
|---|---|
| **Expanding row** — default | A field that expands under the change |
| **Popup** | A dedicated editor with variables and preview |
| **Single field** | The Value field switches between value and formula editing |
| **Formula column** | A labelled Formula column with a field in each row |

Use formulas for numeric attribute changes. Custom changes, macro execution, and native rule changes are not interchangeable with a rolled attribute value.

## Macros

Add an Active Effect change with:

| Field | Value |
|---|---|
| **Attribute Key** | `cae.macro.execute` |
| **Type / Mode** | `Custom` |
| **Value** | A macro UUID, world macro ID, or name, followed by optional arguments |

Quote names that contain spaces:

```text
"Apply Rage" "fire" 2
```

This calls the world macro **Apply Rage** with `fire` and `2` as parsed string arguments. The macro receives an `action` of `on` or `off`, plus the effect context. An unmet condition prevents `on` execution; `off` allows previously activated automation to clean up.

<details>
<summary>Macro context and compatible keys</summary>

| Scope field | Meaning |
|---|---|
| `action` | `on` for activation, `off` for deactivation or removal |
| `actor`, `token` | The affected actor and its token, when available |
| `effect`, `change` | The Active Effect and the macro change |
| `item`, `origin` | Owning/origin item and origin document, when available |
| `macroArgs` | Parsed arguments after the macro reference |
| `args` | `[action, ...macroArgs, lastArg]` |
| `lastArg` | DAE-style context with actor, token, effect, item, and origin identifiers |
| `speaker`, `user` | Chat speaker data and the current Foundry user |

`sc-conditional-ae.macro.execute` remains supported as a legacy alias. `macro.execute` is handled by SC only when DAE is inactive; with DAE enabled, DAE owns that key. Missing macros produce a warning.

</details>

## Target application

In the Condition tab, **When applied to a target** controls reapplication through the D&D 5e effect application workflow:

| Option | Behavior |
|---|---|
| **Default** | Updates the existing target effect associated with the source |
| **Stack** | Creates another target-side effect |
| **Same as DAE** | Follows DAE stacking behavior when DAE is active |

The module preserves its condition, formula, and application metadata when effects are transferred or applied to targets. Tidy 5e drag-and-drop transfer handling is also supported.

## Settings

Open **Configure Settings → Module Settings → SC - Conditional AE → Open settings**. The settings window groups controls into **Effect behavior**, **Interface**, and **Diagnostics**.

| Setting | Scope | Default | Purpose |
|---|---|---|---|
| **Enable formula fields** | World | On | Enables formula editing and activation rolls; requires reload |
| **Post formula roll chat card** | World | Off | Requests formula rolls through chat buttons |
| **Show condition tab** | World | On | Adds condition editing to Active Effect sheets; requires reload |
| **Formula field style** | Client | Expanding row | Chooses how formulas appear on change-row sheets |
| **Tint effect icons** | World | Off | Applies each effect's Icon Tint Color in effect lists; default white leaves icons unchanged |
| **Enable debug logging** | Client | Off | Logs evaluation and refresh details to the browser console |

World settings are controlled by a GM. **Tint effect icons** is a world setting even though it appears under **Interface**; the formula style is a personal preference. Documentation, Discord, and Patreon links are available from the module's settings entry.

<details>
<summary>Settings screenshots</summary>

**Effect behavior**

[![Effect behavior settings for formula fields, formula chat cards, and the Condition tab](https://i.imgur.com/hERtu4P.png)](https://i.imgur.com/hERtu4P.png)

**Interface**

[![Interface settings showing the formula field style and effect icon tint controls](https://i.imgur.com/7cjLrVQ.png)](https://i.imgur.com/7cjLrVQ.png)

*Screenshots show a configured world; use the table above for defaults.*

</details>

## Compatibility

| Integration | What to expect |
|---|---|
| **Foundry VTT v13 and v14** | Supported versions; v14 is the verified target in the module manifest |
| **D&D 5e 4.x–5.x** | Effect-wide conditions and formula editing through the earlier sheet workflow |
| **D&D 5e 6.x** | Native and advanced conditions, per-change evaluation, and a formula control in the change dialog |
| **DAE** | Reads enable/disable conditions, including compatible `@`, `dae.eval(...)`, and `dae.roll(...)` expressions; preserves independently edited DAE fields |
| **Changes tab layouts** | Adapts column widths on row-based sheets when modules add cells; leaves the D&D 5e 6.x card layout intact |
| **Aura Effects** | Provides fallback Active Effect typing when needed |
| **libWrapper** | Recommended for compatibility with other modules that wrap Active Effect behavior |

Existing native filters are preserved when formulas or other change fields are saved. On Core/DAE sheets, omitted per-change fields are retained from the stored effect. Editing or clearing a displayed DAE-backed condition updates that field without clearing its independent counterpart.

The DAE-related `libWrapper` message can be a compatibility warning even when effects work normally. If behavior is wrong, use the checks below and include the warning in your report.

## Troubleshooting

| Problem | Check |
|---|---|
| **An effect or change does not apply** | Inspect its evaluation and, in D&D 5e 6.x, the general conditions too. Check syntax, attribute paths, and whether roll context is required. |
| **The effect disables itself** | Check **When the condition is not met**. Choose suppression if you want it to remain enabled. |
| **A condition seems to disappear** | Save with **Submit Changes**, reopen the same General or Change scope, and check the JSON view. If this keeps happening, report the exact sequence and installed versions. |
| **The formula field is missing** | Enable formula fields, reload, and check the selected field style. In D&D 5e 6.x, open the individual change dialog. |
| **A formula does not roll** | Check eligibility, conditions, actor ownership, and whether chat-card mode is waiting for a click. |
| **A macro does not run** | Verify the key, Custom type/mode, macro reference, and conditions. Quote macro names that contain spaces. |
| **Lighting gives an unexpected result** | Confirm that the actor has a token on the current canvas. Linked actors with multiple tokens use the first active token. |
| **A rule based on selected targets seems stale** | Target-selection changes are not a dedicated refresh trigger. Use an activity-time rule for action-specific targets. |

For a reproducible issue, include Foundry and D&D 5e versions, the module version, relevant integrations, and the steps that trigger it. **Enable debug logging** can help capture evaluation details.

## Public API

Available after Foundry's `ready` hook:

```js
const api = game.modules.get("sc-conditional-ae").api;
```

<details>
<summary>API methods and condition storage</summary>

| Method | Returns or purpose |
|---|---|
| `getCondition(effect)` | Stored SC condition or adapted DAE condition |
| `hasCondition(effect)` | Whether an SC/DAE condition is configured |
| `validateCondition(code)` | `{ valid, error }` |
| `evaluate(effect, options?)` | `{ available, error, result }` |
| `shouldSuppress(effect)` | Whether the SC/DAE condition should suppress the effect |
| `getToken(actor)` | The actor's synthetic or first active canvas token |
| `getLightLevel(token)` | `"bright"`, `"dim"`, `"dark"`, or `null` |
| `lightLevels` | Canonical `BRIGHT`, `DIM`, and `DARK` values |

The condition API above addresses effect-wide SC/DAE conditions. It is not the combined native/per-change diagnosis shown in the D&D 5e 6.x editor.

In D&D 5e 6.x, native filters remain in `system.conditions` and `system.changes[*].conditions`. SC stores effect-wide JavaScript in `flags.sc-conditional-ae.condition` and change-specific JavaScript in `flags.sc-conditional-ae.changeConditions`, keyed by the change's stable ID.

</details>

## Support

- **Guides and examples:** [Official wiki](https://wiki.shattered-codex.com/modules/sc-conditional-ae)
- **Community and questions:** [Shattered Codex Discord](https://discord.gg/nZJVbbkMTk)
- **Bugs and feature requests:** [GitHub issues](https://github.com/Shattered-Codex/sc-conditional-ae/issues)
- **Releases:** [Download history](https://github.com/Shattered-Codex/sc-conditional-ae/releases)
- **Support development:** [Shattered Codex on Patreon](https://www.patreon.com/c/shatteredcodex?utm_source=sc-conditional-ae&utm_medium=github&utm_campaign=support_readme)

SC - Conditional AE is a Shattered Codex project. English and Brazilian Portuguese translations are included.
