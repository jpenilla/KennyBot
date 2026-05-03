# KennyBot

A Flue-powered GitHub issue triage bot. Other repos consume it via a composite GitHub Action.

## Quickstart

Add this workflow to your repo (`.github/workflows/issue-triage.yml`):

```yaml
name: Issue Triage
on:
  issues:
    types: [opened]

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      issues: read
    outputs:
      decision: ${{ steps.triage.outputs.decision }}
    steps:
      - uses: actions/checkout@v4
      - id: triage
        uses: jpenilla/KennyBot/.github/actions/triage@main
        with:
          issue-number: ${{ github.event.issue.number }}
          model: opencode-go/deepseek-v4-flash
        env:
          OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}

  process:
    needs: analyze
    if: ${{ needs.analyze.outputs.decision != '' }}
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: jpenilla/KennyBot/.github/actions/process@main
        with:
          decision: ${{ needs.analyze.outputs.decision }}
          issue-number: ${{ github.event.issue.number }}
```

Set the API key for your chosen model as a repo secret. See [flueframework.com](https://flueframework.com) for available models and their env var names.

Open an issue — the bot will triage it.

### Custom skill

Add a `custom-skill-path` input pointing at your own `SKILL.md` in your repo:

```yaml
        with:
          issue-number: ${{ github.event.issue.number }}
          custom-skill-path: .github/kennybot-triage.md
```

## Architecture

Two jobs, strict separation of concerns:

1. **analyze** (`issues: read`) — The Flue agent reads the issue, searches for duplicates via `gh`, and returns a structured decision.
2. **process** (`issues: write`) — A deterministic JS script parses the decision and calls Octokit. No LLM involvement.

### Decisions

| Decision | Action |
|---|---|
| `leave-open` | Comment (optional) + add labels, leave open |
| `close-invalid` | Comment explaining why, close |
| `close-duplicate` | Comment referencing original + `duplicateOf`, close |
| `close-done` | Comment noting already addressed, close |
