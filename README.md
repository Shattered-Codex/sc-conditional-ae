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
