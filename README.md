<p align="center">
  <a href="https://www.patreon.com/c/shatteredcodex?utm_source=sc-conditional-ae&utm_medium=github&utm_campaign=support_readme">
    <img src="https://i.imgur.com/9kf3oWy.png" alt="Shattered Codex" width="200" height="200" />
  </a>
</p>

# SC - Conditional AE

[![Wiki](https://img.shields.io/badge/Wiki-SC%20Conditional%20AE-1f6feb?logo=bookstack&logoColor=white&style=for-the-badge)](https://wiki.shattered-codex.com/modules/sc-conditional-ae)
[![Support on Patreon](https://img.shields.io/badge/Patreon-Shattered%20Codex-FF424D?logo=patreon&logoColor=white&style=for-the-badge)](https://www.patreon.com/c/shatteredcodex?utm_source=sc-conditional-ae&utm_medium=github&utm_campaign=support_readme)
![Foundry VTT 13-14](https://img.shields.io/badge/Foundry%20VTT-v13%20%7C%20v14-orange?logo=foundry-vtt&logoColor=white&style=for-the-badge)
![System: dnd5e](https://img.shields.io/badge/System-dnd5e-blue?style=for-the-badge)
[![libWrapper Recommended](https://img.shields.io/badge/libWrapper-Recommended-8A2BE2?style=for-the-badge)](https://github.com/ruipin/fvtt-lib-wrapper)
![Downloads](https://img.shields.io/github/downloads/Shattered-Codex/sc-conditional-ae/total?style=for-the-badge)

Add JavaScript conditions, formula-backed changes, and macro execution to `dnd5e` Active Effects.

[Report an issue or request a feature](https://github.com/Shattered-Codex/sc-conditional-ae/issues) - [Official Wiki](https://wiki.shattered-codex.com/modules/sc-conditional-ae)

---

## Overview

SC - Conditional AE extends the `dnd5e` Active Effect workflow in three major ways:

| Feature | What it adds | Typical use |
|---|---|---|
| Condition tab | A dedicated Active Effect tab that evaluates JavaScript or compatible DAE expressions | Only apply an effect while HP is above 0, while combat is running, or when an item matches a rule |
| Formula column | A per-change formula field that rolls when the effect becomes active | Randomized bonuses, penalties, temp HP changes, or re-rollable values |
| Macro execution change | A special change key that executes a world macro when the effect turns on or off | Trigger side effects, automation, chat output, or external module integrations |

Additional current module behavior:

| Area | Current behavior |
|---|---|
| Condition UX | Includes live validation, current evaluation feedback, a wiki shortcut, and a configurable inactive badge label |
| Target application | Lets you choose whether reapplying an effect to a target updates the existing effect or stacks a duplicate |
| Formula UX | Supports immediate rolling or optional chat cards, plus roll buttons on effect lists |
| Transfer handling | Preserves module flags on transferred effects so condition, formula, and apply-behavior metadata survive target application |
| Compatibility | Supports Foundry VTT `v13` and `v14`, `dnd5e` `4.0.0+`, DAE condition content, and Aura Effects fallback typing |

If a condition resolves to `false`, or throws an error, the effect is suppressed and its changes do not apply.

---

## Requirements

| Requirement | Status |
|---|---|
| Foundry VTT | `13` or `14` |
| System | `dnd5e` |
| Minimum `dnd5e` version | `4.0.0` |
| `libWrapper` | Recommended for best compatibility |
| DAE | Optional, with compatibility support |

---

## Installation

1. Open Foundry VTT and go to **Add-on Modules -> Install Module**.
2. Paste this manifest URL:

```text
https://github.com/Shattered-Codex/sc-conditional-ae/releases/latest/download/module.json
```

3. Install the module and enable **SC - Conditional AE** in your world.
4. If your world uses many modules touching Active Effects, also install **libWrapper**.

---

## Condition Tab

When **Show condition tab** is enabled, Active Effect sheets gain a **Condition** tab.

Write either:

- a short JavaScript expression
- or a small block with `return`

Both forms are valid:

```js
actor?.system?.attributes?.hp?.value > 0
```

```js
return actor?.system?.attributes?.hp?.value > 0;
```

### What the tab includes

| UI element | What it does |
|---|---|
| Condition editor | Stores the effect condition as JavaScript or adapted DAE-compatible content |
| Current evaluation | Shows whether the effect is currently available, suppressed, empty, or throwing an error |
| Condition badge label | Defines a short label shown on inactive effects when the condition is not met |
| When applied to a target | Controls whether target application updates an existing effect or creates a new stack |
| Wiki link | Opens the module wiki directly from the sheet |

### Available variables

| Variable | Meaning |
|---|---|
| `effect` | The Active Effect being evaluated |
| `actor` | The affected actor |
| `targetActor` | Alias of the affected actor |
| `item` | The owning item, when applicable |
| `origin` | The effect origin document, when available |
| `originActor` | The actor tied to the origin document, when available |
| `user` | The current Foundry user |
| `rollData` | The actor roll data, resolved lazily |
| `source` | A cloned source snapshot of the effect |
| `getProperty` | `foundry.utils.getProperty` |
| `hasProperty` | `foundry.utils.hasProperty` |
| `deepClone` | `foundry.utils.deepClone` |
| `game` | The Foundry `game` object |

### Evaluation rules

| Rule | Behavior |
|---|---|
| Empty condition | The effect remains available |
| `true` result | The effect applies normally |
| `false` result | The effect is suppressed |
| Error thrown | The effect is suppressed and the error is shown in the evaluation panel |
| Promise or async result | Treated as invalid; conditions must be synchronous |

### Apply behavior on targets

This setting matters when an effect is applied to a target through the `dnd5e` effect application flow.

| Option | Behavior |
|---|---|
| `Default` | Reapplies the current Active Effect by updating the existing target effect tied to the same origin |
| `Stack` | Creates a new target-side Active Effect instead of updating the existing one |
| `Same as DAE` | Uses DAE stacking semantics when DAE is active |

### Ready-to-copy examples

Apply only while the actor has HP remaining:

```js
return actor?.system?.attributes?.hp?.value > 0;
```

Apply only while the actor is bloodied:

```js
return actor?.system?.attributes?.hp?.value <= (actor?.system?.attributes?.hp?.max ?? 0) / 2;
```

Apply only while combat is active:

```js
return Boolean(game.combat);
```

Apply only for a specific item type:

```js
return item?.system?.type?.value === "martialM";
```

---

## DAE Compatibility

SC - Conditional AE can read and preserve DAE condition content.

| DAE content | Support |
|---|---|
| `flags.dae.enableCondition` | Read and surfaced in the Condition tab |
| `flags.dae.disableCondition` | Read and surfaced in the Condition tab |
| `@` roll-data expressions | Preserved through compatibility evaluation |
| `dae.eval(...)` and `dae.roll(...)` style expressions | Preserved when used as compatibility expressions |

What this means in practice:

- Older DAE-driven conditions can be opened in the new UI.
- The module adapts them automatically instead of forcing a full rewrite.
- If DAE is active, a `libWrapper` warning may appear in the browser console. That warning is expected and does not necessarily indicate broken behavior.

---

## Formula-Backed Changes

When **Enable formula column** is enabled, the Active Effect changes table gains a **Formula** column.

Use it on normal non-custom changes when you want the effect value to be rolled at activation time.

Example:

```text
Attribute Key: system.attributes.hp.tempmax
Mode: Add
Value: 0
Formula: -2d6
```

### Formula flow

| Step | What happens |
|---|---|
| 1 | The effect becomes active, is re-enabled, or a previously false condition becomes true |
| 2 | The responsible user is chosen |
| 3 | The formula is rolled immediately, or a chat card is posted if that setting is enabled |
| 4 | The total is written into the normal change value |

### Who rolls

| Priority | User selected |
|---|---|
| 1 | An active non-GM owner of the actor |
| 2 | An active GM, if no active player owner is available |

### Formula UX

| Feature | Behavior |
|---|---|
| Sheet column | Adds a formula input beside each eligible change value |
| Immediate rolling | Default behavior when a formula-backed effect becomes active |
| Chat card mode | Optional setting that posts a chat card with one-click roll buttons instead of rolling immediately |
| Effect list roll button | Adds a d20 control to supported actor and item effect lists when formulas are available |

### Good use cases

| Use case | Example |
|---|---|
| Variable bonuses | Random temporary stat boosts |
| Variable penalties | Random HP max reductions or debuffs |
| Re-roll on reactivation | Effects that should change every time they come back online |

---

## Macro Execution Changes

To execute a world macro from an Active Effect, add a change with the following setup:

| Field | Value |
|---|---|
| Key | `cae.macro.execute` |
| Mode | `Custom` |
| Value | Macro name or macro UUID, followed by optional arguments |

Example:

```text
Apply Rage "fire" 2
```

That tries to execute the world macro `Apply Rage` and pass `fire` and `2` as arguments.

### Supported change keys

| Key | Status |
|---|---|
| `cae.macro.execute` | Primary key |
| `sc-conditional-ae.macro.execute` | Legacy key, still supported |
| `macro.execute` | Supported only when DAE is not active |

If DAE is active, DAE remains responsible for `macro.execute`.

### What the macro receives

| Scope field | Meaning |
|---|---|
| `action` | `on` when applied or re-enabled, `off` when disabled or deleted |
| `actor` | The actor that owns the effect |
| `token` | The first active token found for the actor, when available |
| `effect` | The Active Effect document |
| `item` | The owning or origin item, when available |
| `origin` | The origin document, when available |
| `change` | The individual effect change being executed |
| `args` | `[action, ...macroArgs, lastArg]` |
| `macroArgs` | Parsed arguments after the macro name |
| `lastArg` | DAE-style summary payload with actor, token, effect, item, and origin identifiers |
| `speaker` | `ChatMessage.getSpeaker(...)` for the actor/token context |
| `user` | The current Foundry user |

### Macro notes

| Note | Details |
|---|---|
| Macro lookup | First tries UUID, then world macro ID/name |
| Quoted arguments | Supported, including escaped quotes |
| Condition-aware | `on` execution is skipped while the effect is suppressed |
| Missing macro | Shows a warning notification instead of failing silently |

---

## Applying Effects to Targets

The module now carries its own metadata when effects are transferred or applied to targets, so condition, formula, and apply-behavior flags stay attached to the target-side effect.

| Scenario | Behavior |
|---|---|
| Item effect transferred to actor | Module flags are mirrored so the actor-side effect keeps condition/formula metadata |
| Reapplying the same origin effect | Controlled by the **When applied to a target** setting |
| Stacked target application | Duplicate mode forces a fresh effect ID and multi-stack semantics |
| Tidy 5e drag/drop | Supported through remembered drop context so transferred flags can be restored correctly |

---

## Settings

Open **Game Settings -> Module Settings -> SC - Conditional AE -> Open settings**.

The module uses an Application V2 settings window and also exposes documentation/support menus in module settings.

| Setting | Scope | Default | Reload required | What it does |
|---|---|---|---|---|
| Enable formula column | World | On | Yes | Adds the Formula column and enables formula-backed Active Effect rolling |
| Post formula roll chat card | World | Off | No | Posts a chat card when formulas become available instead of rolling immediately |
| Show condition tab | World | On | Yes | Adds the Condition tab to Active Effect configuration sheets |
| Enable debug logging | Client | Off | No | Logs condition evaluation, refreshes, and activation transitions to the browser console |
| Documentation | Menu | - | No | Opens the module wiki |
| Support the developer | Menu | - | No | Opens the Patreon support page |

---

## Public API

On `ready`, the module exposes a small API on:

```js
game.modules.get("sc-conditional-ae").api
```

| Method | What it does |
|---|---|
| `getCondition(effect)` | Returns the stored condition or adapted DAE condition |
| `hasCondition(effect)` | Returns whether the effect has a condition |
| `validateCondition(code)` | Validates condition code and returns `{ valid, error }` |
| `evaluate(effect, options?)` | Evaluates the condition and returns `{ available, error, result }` |
| `shouldSuppress(effect)` | Returns whether the effect should be suppressed |

---

## Compatibility

| Integration | Status | Notes |
|---|---|---|
| Foundry VTT v13 | Supported | UI and Active Effect handling are built for v13 and v14 |
| Foundry VTT v14 | Supported | Verified target in `module.json` |
| `dnd5e` | Required | Module warns and stops setup outside `dnd5e` |
| DAE conditions | Supported | Legacy flags and compatibility expressions are adapted |
| DAE macro key | Partial | `macro.execute` is only handled here when DAE is not active |
| Aura Effects | Safe fallback | Registers a fallback `auraeffects.aura` Active Effect type when needed |
| `libWrapper` | Recommended | Best path for patch compatibility |

---

## Troubleshooting

| Problem | What to check |
|---|---|
| The effect never applies | Confirm the condition returns `true`, contains valid synchronous code, and still matches current actor/item data |
| The effect shows as inactive with a badge | The configured condition badge label is appearing because the condition currently evaluates to `false` |
| The Formula column is missing | Make sure **Enable formula column** is on, then reload the world |
| The formula did not roll | Confirm the effect actually became active, the change is eligible, and the responsible user is the one viewing the prompt or chat card |
| The macro did not run | Check the key, confirm the mode is `Custom`, verify the world macro exists, and confirm the effect is not suppressed |
| I see a `libWrapper` warning with DAE active | This is an expected compatibility warning when both modules touch the Active Effect pipeline |
| My old DAE condition now looks different | Expected; the module surfaces DAE condition content through the unified Condition tab |

---

## Useful Links

| Resource | Link |
|---|---|
| Wiki | https://wiki.shattered-codex.com/modules/sc-conditional-ae |
| Bug reports and feature requests | https://github.com/Shattered-Codex/sc-conditional-ae/issues |
| Patreon | https://www.patreon.com/c/shatteredcodex |

---

SC - Conditional AE is a [Shattered Codex](https://www.patreon.com/c/shatteredcodex) project.
