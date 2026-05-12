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

Add JavaScript conditions, formula-backed changes, and macro execution to dnd5e Active Effects.

[Report an issue or request a feature](https://github.com/Shattered-Codex/sc-conditional-ae/issues) - [Official Wiki](https://wiki.shattered-codex.com/modules/sc-conditional-ae)

---

## What does this module do?

SC - Conditional AE extends the **dnd5e Active Effect** workflow in three ways:

1. It adds a **Condition** tab to the Active Effect configuration sheet.
2. It adds an optional **Formula** column to effect changes.
3. It lets an Active Effect **execute a world macro** when the effect turns on or off.

In practice, that means you can do things like:

- Apply an effect only while the actor has more than 0 HP.
- Roll a formula when the effect activates and write the total into the change value.
- Trigger a macro when the effect is applied or removed.

If a condition returns `false`, the effect is **suppressed** and does not apply.

---

## Requirements

- **Foundry VTT:** version 13 or 14
- **System:** D&D 5e
- **Recommended:** [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper) for best compatibility
- **Optional compatibility:** DAE expressions and legacy DAE condition flags are supported

---

## Installation

1. Open Foundry VTT and go to **Add-on Modules -> Install Module**.
2. Paste this URL into the **Manifest URL** field:

```text
https://github.com/Shattered-Codex/sc-conditional-ae/releases/latest/download/module.json
```

3. Click **Install**, then enable **SC - Conditional AE** in your world.
4. If you use many other modules, also install **libWrapper**.

---

## How it works: the three pieces

Before configuring effects, it helps to know what the module adds:

| Feature | What it does | Where you use it |
|---|---|---|
| **Condition tab** | Runs JavaScript to decide whether the effect should be active | Active Effect sheet |
| **Formula column** | Rolls a formula and writes the rolled total into the change value | Active Effect changes |
| **Macro change** | Executes a world macro when the effect turns on or off | Active Effect changes |

---

## Using the Condition tab

When **Show condition tab** is enabled, Active Effect sheets gain a new **Condition** tab.

Write a JavaScript expression or a small `return` block there. The effect is applied only when the code returns `true`.

Simple example:

```js
return actor?.system?.attributes?.hp?.value > 0;
```

Short expression example:

```js
actor?.system?.attributes?.hp?.value > 0
```

Both work. If you omit `return`, the module wraps the expression for you.

### Available variables

These are available inside the condition:

- `effect`
- `actor`
- `targetActor`
- `item`
- `origin`
- `originActor`
- `user`
- `rollData`
- `source`
- `getProperty`
- `hasProperty`
- `deepClone`
- `game`

### Important notes

- Conditions must be **synchronous**. Do not use async code.
- Invalid code suppresses the effect instead of partially applying it.
- The condition is checked both for actor effects and transferred item effects.

### Ready-to-copy examples

Apply only while the actor is bloodied:

```js
return actor?.system?.attributes?.hp?.value <= (actor?.system?.attributes?.hp?.max ?? 0) / 2;
```

Apply only to melee weapons:

```js
return item?.system?.type?.value === "martialM";
```

Apply only while combat is active:

```js
return Boolean(game.combat);
```

---

## DAE compatibility

If an effect already uses one of these DAE flags:

- `flags.dae.enableCondition`
- `flags.dae.disableCondition`

SC - Conditional AE automatically adapts that content into the **Condition** tab.

That means you can open older DAE-based effects, edit them in the new UI, and save them without manually rewriting every condition first.

DAE-style expressions that rely on `@` roll data references are also preserved.

---

## Using formula-backed changes

When **Enable formula column** is enabled, the Active Effect changes table gets a **Formula** column.

Use it on normal non-custom changes when you want the effect to roll a value at activation time.

Example:

```text
Attribute Key: system.attributes.hp.tempmax
Mode: Add
Value: 0
Formula: -2d6
```

What happens:

1. The effect becomes active.
2. The responsible user is prompted to roll the formula.
3. The rolled total is written into the normal **Value** field.
4. If the effect is disabled and enabled again later, it rolls again.

### Who rolls?

The module tries to give the roll to the most appropriate user:

- An active non-GM owner of the actor rolls first.
- If there is no active player owner, the active GM rolls.

### Good use cases

- Variable temporary HP penalties or bonuses
- Randomized stat adjustments
- Effects that should re-roll every time they come back online

---

## Using macro execution changes

To execute a world macro from an Active Effect, add a change with:

- **Key:** `cae.macro.execute`
- **Mode:** `Custom`
- **Value:** macro name or UUID, followed by optional arguments

Example:

```text
Apply Rage "fire" 2
```

That would try to execute a world macro named `Apply Rage` and pass `fire` and `2` as arguments.

### What the macro receives

The macro gets a scope containing:

- `action`
- `actor`
- `token`
- `effect`
- `item`
- `origin`
- `change`
- `args`
- `macroArgs`
- `lastArg`
- `speaker`
- `user`

`action` is:

- `on` when the effect is applied or re-enabled
- `off` when the effect is disabled or deleted

### Compatibility notes

- `sc-conditional-ae.macro.execute` is also supported as a legacy key.
- `macro.execute` is supported when DAE is **not** active.
- If DAE is active, DAE remains responsible for `macro.execute`.

---

## Module Settings

Go to **Game Settings -> Module Settings -> SC - Conditional AE**.

| Setting | Default | What it does |
|---|---|---|
| **Enable formula column** | On | Adds the Formula column to Active Effect changes and enables activation-time rolls |
| **Show condition tab** | On | Adds the Condition tab to Active Effect configuration sheets |
| **Documentation** | - | Opens the module wiki |
| **Support the developer** | - | Opens the Patreon support page |

Both boolean settings require a reload after changing them.

---

## Troubleshooting

### The effect never applies

Check these in order:

1. Open the **Condition** tab and confirm the script returns `true`.
2. Make sure the code is valid JavaScript.
3. Do not use async code or Promises.
4. If the effect came from DAE, verify the original expression still makes sense in the current actor data.

### The Formula column is missing

Check two things:

1. **Enable formula column** must be on.
2. Reload the world after changing that setting.

### The macro does not run

Check these four things:

1. The change key is `cae.macro.execute`.
2. The change mode is **Custom**.
3. The referenced macro exists in the **world macros** directory.
4. The effect is not being suppressed by its condition.

### My old DAE condition looks different now

That is expected. The module reads old DAE condition flags and surfaces them in the new Condition tab so they can be edited in one place.

---

## Compatibility

| What | Status |
|---|---|
| Foundry VTT v13 | Supported |
| Foundry VTT v14 | Supported |
| D&D 5e system | Required |
| DAE condition content | Supported |
| Aura Effects typed data | Safe fallback included |
| libWrapper | Recommended |

---

## Useful Links

- **Wiki:** https://wiki.shattered-codex.com/modules/sc-conditional-ae
- **Bug reports and requests:** https://github.com/Shattered-Codex/sc-conditional-ae/issues
- **Patreon:** https://www.patreon.com/c/shatteredcodex

---

SC - Conditional AE is a [Shattered Codex](https://www.patreon.com/c/shatteredcodex) project.
