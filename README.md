# Clean View + Agent Dock

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

## Agent Dock

Pick a Team Size (1 to 100) and every request is split across exactly that many parallel helper agents. A live pane shows one card per helper (face, task name, meter, timer), a mission bar, and a one-line summary when they finish. It lives in this same plugin and uses Clean View's `report_progress` tool.

### Use

- `/dock` opens the pane, or folds it to a status badge like `12 working · 8 queued · 30 done`. Type it again to reopen.
- `/dock 10` sets the Team Size. Above 20 it asks you to confirm in the pane ("Big team: this uses your plan quickly. Continue?"), and a size above 20 resets to 1 in the next session.
- The **◆ Dock** button above the prompt does the same as `/dock`.
- **Helper agents** row in the pane: *Fast & Cheap* (Haiku, only when Team Size is above 1 and the Agent call named no model) or *Same as me*.
- At size 1 nothing is added to your requests; Claude and your own skills behave exactly as before.

### Settings you want

Claude Code refuses an Agent call past `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (default 20) instead of queueing, so the dock holds the extra calls itself and releases them as slots free up. To run waves of 20, add this to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "20",
    "CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY": "20"
  }
}
```

"At a time" in the pane is the lower of the two values (defaults 20 and 10).

### Notes

- At Team Size above 1 the dock runs each helper in the foreground so a call stays open while its helper works (that is what lets it queue and time them).
- The live helper count is written to `~/.claude/ai-employee-kit-data/agents-now/<session_id>.json` for a status line segment.
- Headshots: put PNGs in `~/.claude/ai-employee-kit-data/employee-headshots/` (or `employee-headshots/` in the plugin) and a terminal that can draw images shows them on the cards (up to 12 helpers). Everything else gets a colored two-letter badge.
- The idle seats are static: the dock runs no timers while idle.

### Develop

`hooks/dock-logic.ts` holds all `$`-free logic; `hooks/dock.tsx` holds every `$` call. Tests are in `tests/`.
