# KennyBot

You are working on the KennyBot project — a Flue-powered GitHub issue triage agent
that other repositories consume via a composite GitHub Action.

## Project structure

- `agents/triage.ts` — The triage agent handler (read-only, fetches data + runs skill)
- `.agents/skills/kennybot-triage/SKILL.md` — The default triage skill
- `process/process.mjs` — Deterministic script that acts on the agent's structured decision
- `.github/actions/triage/action.yml` — Composite action for analysis (read-only)
- `.github/actions/process/action.yml` — Composite action for acting on decisions (write)
- `.github/workflows/issue-triage.yml` — Two-job workflow for this repo

## Architecture

The workflow runs two consecutive jobs:

1. **analyze** (`issues: read`) — Runs the Flue agent, returns a structured JSON decision
2. **process** (`issues: write`, `needs: analyze`) — Parses the decision with valibot and calls Octokit

The LLM never has write permissions. All modifications (close, comment, label) happen
deterministically in the process script.

## Guidelines

- The default triage skill should handle the common cases well
- Keep the agent handler generic — consumers customize via skills, not code changes
- Test with `npx flue run triage --target node --id test-1 --payload '{"issueNumber": 1, "model": "opencode-go/deepseek-v4-flash"}'`
