# Clean View

A Claude Code mod that hides tool calls, diffs and command output while Claude works and shows one plain checklist above the prompt (job name, timer, steps, progress meters, and an on/off button).

## Install

```
/plugin install clean-view --marketplace jjy714/claude-workspace
```

Answer `y` to add the marketplace, then pick the user scope.

## Use

- Click the **Clean View: ON/OFF** button at the right of the header row, or type `/simple on`, `/simple off`, or `/simple` to flip it.
- The setting is saved and survives restarts. Clean View starts on.

## Develop

```
claude plugin validate .
claude plugin test .
```
