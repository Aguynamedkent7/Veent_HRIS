---
name: riper5
description: RIPER-5 (Research, Innovate, Plan, Execute, Review) strict mode-gated development protocol, the "vibecode pro max" harness. Prevents premature implementation by requiring an explicit user go-ahead between phases. Use ONLY when the user explicitly invokes it in that turn — "/riper5", "RIPER-5", "vibecode pro max", "enter research/innovate/plan/execute/review mode". Never activate proactively, and never suggest or offer it for any task, however large.
---

# RIPER-5

Modeled on the vibecode-pro-max-kit RIPER-5 methodology (as run in the `parasat` repo), condensed for this repo's scale: no dedicated subagents, no write-guard hooks, no `process/features/` scaffolding — just single-thread phase discipline enforced by this skill.

## Activation

- **Off by default.** Applies only to the turn(s) where the user names it — a trigger phrase above, or `/riper5`.
- **Does not persist silently.** If a later message doesn't reference RIPER-5 and isn't an obvious continuation of an open RIPER-5 task, drop back to normal behavior.
- **Never offer or suggest this mode**, for any task, no matter how large or risky. The user asks, or it does not run.
- **Exit:** "stop riper5" / "normal mode", or moving on to unrelated work.

## The five modes

Every response while active opens with `[MODE: <NAME>]`.

1. **RESEARCH** — Read-only. Gather facts about the current code/behavior. No suggestions, no code, no opinions on what to do.
2. **INNOVATE** — Brainstorm possible approaches and tradeoffs. No code, no final decision, no file writes.
3. **PLAN** — Exhaustive, specific implementation plan (files, functions, order of changes). No code yet. End with a numbered checklist.
4. **EXECUTE** — Implement exactly what the approved plan says. Any deviation, however small, gets flagged, not silently made.
5. **REVIEW** — Validate the implementation against the plan, line by line. Call out unreported deviations explicitly; don't rubber-stamp.

## Phase transition rules

- Start in RESEARCH unless the user names a different entry mode.
- Advancing to the next mode requires the user's explicit go-ahead that turn ("go", "proceed", "enter plan mode", approving the plan) — never auto-advance.
- EXECUTE never starts without an approved PLAN from the same session.
- If something mid-EXECUTE invalidates the plan, stop, report it, and return to PLAN instead of improvising.

## Scale-appropriate scope

This repo doesn't need the full vibecode-pro-max-kit apparatus (per-phase subagents, `PreToolUse` write-guards, phase-program loops, feature-folder scaffolding) — that exists in `parasat` because of its size. Here, five modes and explicit gates on one thread are enough. If a task genuinely grows to warrant heavier machinery, say so rather than quietly reinventing it.
