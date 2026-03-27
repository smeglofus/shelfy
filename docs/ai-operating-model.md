# AI Operating Model

How AI agents and the human owner collaborate on Shelfy.

## Roles

### Human (Product Owner + Final Reviewer)

- Defines direction, priorities, ICP, scope
- Reviews and merges all PRs
- Resolves escalations (`needs-human-review`)
- Makes architecture decisions (with Claude input)
- Writes issue descriptions or verbal instructions

### Codex (Primary Implementation Agent)

- Reads `docs/current-status.md` + `AGENTS.md` before any task
- Implements features, fixes, tests from GitHub issues or prompts
- Opens PRs with required description format
- Max 2 fix iterations per PR, then escalates with `needs-human-review` label
- Does NOT make architectural decisions — follows spec or asks

### Claude Code (Architecture + Review + Specialist)

- Architecture reviews, tech reviews, security reviews
- Designs implementation plans and writes prompts for Codex
- Occasional direct implementation (complex features, frontend work)
- Produces ADRs and documentation structure
- Expensive — used selectively, not for routine CRUD

### CodeRabbit (Automated PR Reviewer)

- Reviews every PR automatically against `docs/coding-standards.md`
- Flags: raw SQL, missing Pydantic models, `print()`, missing tests, `any` in TS, hardcoded secrets

## Workflow

```
1. Human creates issue or gives verbal instruction
2. (Optional) Claude designs approach / writes Codex prompt
3. Codex implements on a feature branch
4. CI runs (ruff, mypy, pytest, eslint, vitest)
5. CodeRabbit reviews automatically
6. Codex addresses review comments (max 2 iterations)
7. (Optional) Claude reviews if architectural / complex
8. Human reviews and merges
```

## Escalation Rules

- CI fails 2x on same issue -> Codex labels `needs-human-review`, stops
- Architectural ambiguity -> Codex stops and asks, does not guess
- Scope creep detected -> flag it in PR comment, do not implement
- Complex debugging (>30min blocked) -> escalate to Claude or human

## Document Update Protocol

After every merged PR that changes behavior, the merging workflow must update:

| What changed | Update |
|---|---|
| Schema / model fields | `docs/entity-design.md` |
| Phase completed or started | `docs/current-status.md` |
| New architectural decision | new file in `docs/adr/` |
| New environment variable | `.env.example` |
| Agent rules changed | `docs/AGENTS.md` |

## Cost Optimization

- Codex handles 80%+ of implementation work (routine features, bug fixes, tests)
- Claude is reserved for: architecture design, complex debugging, frontend work, review of non-trivial PRs, writing Codex prompts
- CodeRabbit runs on every PR at zero marginal cost
- Human time is spent on direction, review, and merge decisions — not on writing code
