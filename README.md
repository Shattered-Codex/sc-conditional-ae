# SC - Conditional AE

Adds a Condition tab to dnd5e Active Effect configuration sheets.

## Macro changes

Use `cae.macro.execute` with change mode `Custom` to execute a world macro when an Active Effect is applied or removed.

Value format:

```text
Macro Name optionalArg "optional arg with spaces"
```

The macro receives a scope containing `action`, `actor`, `token`, `effect`, `item`, `origin`, `change`, `args`, `macroArgs`, `lastArg`, `speaker`, and `user`.

For compatibility with DAE content, `macro.execute` is also supported when DAE is not active. When DAE is active, DAE remains responsible for `macro.execute`.

## Rolled formulas in normal changes

For non-custom changes, values containing dice formulas are rolled when the Active Effect is applied or re-enabled.

Example:

```text
Attribute Key: system.attributes.hp.tempmax
Type: Add
Value: -2d6
```

The original formula is stored in `flags.sc-conditional-ae.formulaChanges`. When the effect is disabled and enabled again, the responsible user is prompted with the dnd5e roll dialog and rolls again. If an active non-GM owner exists for the actor, that user rolls; otherwise the active GM rolls.
