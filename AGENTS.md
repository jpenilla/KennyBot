# KennyBot

You are working on the KennyBot project — a Flue-powered GitHub issue triage agent
that other repositories consume via a composite GitHub Action.

## Project structure

- `agents/triage.ts` — The triage agent handler
- `.agents/skills/kennybot-triage/SKILL.md` — The default triage skill
- `.github/actions/triage/action.yml` — Composite action for consumers
- `.github/workflows/issue-triage.yml` — Workflow for this repo

## Guidelines

- The default triage skill should handle the common cases well
- Keep the agent handler generic — consumers customize via skills, not code changes
- Test with `npx flue run triage --target node --id test-1 --payload '{"issueNumber": 1, "model": "opencode-go/deepseek-v4-flash"}'`
