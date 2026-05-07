# SC - Conditional AE

Adds a Condition tab to dnd5e Active Effect configuration sheets.

If an Active Effect still uses a DAE condition from `flags.dae.enableCondition` or `flags.dae.disableCondition`, SC - Conditional AE adapts it automatically in the Condition tab. DAE-style expressions, including `@` roll data references, are preserved when the effect is saved into `flags.sc-conditional-ae.condition`.

## Macro changes

Use `cae.macro.execute` with change mode `Custom` to execute a world macro when an Active Effect is applied or removed.

Value format:

```text
Macro Name optionalArg "optional arg with spaces"
```

The macro receives a scope containing `action`, `actor`, `token`, `effect`, `item`, `origin`, `change`, `args`, `macroArgs`, `lastArg`, `speaker`, and `user`.

For compatibility with DAE content, `macro.execute` is also supported when DAE is not active. When DAE is active, DAE remains responsible for `macro.execute`.

## Formula changes

For non-custom changes, use the Formula column to define a dice formula that is rolled when the Active Effect is applied or re-enabled. The rolled total is written to the normal Value field.

Example:

```text
Attribute Key: system.attributes.hp.tempmax
Type: Add
Value: 0
Formula: -2d6
```

The formula is stored in `flags.sc-conditional-ae.formulaChanges`. When the effect is disabled and enabled again, the responsible user is prompted with the dnd5e roll dialog and rolls again. If an active non-GM owner exists for the actor, that user rolls; otherwise the active GM rolls.
