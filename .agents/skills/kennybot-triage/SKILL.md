---
name: kennybot-triage
description: >
  Triage a GitHub issue — search for duplicates, assess validity, and close if invalid.
  Uses the `gh` CLI to interact with the GitHub API.
---

Given the issue number in the arguments, follow these steps:

1. **Fetch the issue details**
   ```bash
   gh issue view <issueNumber> --json title,body,author,labels,state,createdAt,comments
   ```
   Carefully read the title, body, and any existing comments.

2. **Search for duplicates**
   ```bash
   gh issue list --state open --limit 30 --search "<relevant keywords from the issue>"
   ```
   Also search closed issues:
   ```bash
   gh issue list --state closed --limit 20 --search "<relevant keywords>"
   ```
   Determine if this issue is a duplicate of an existing or past issue.

3. **Assess validity**
   Consider whether the issue is:
   - **Spam** — clearly promotional, irrelevant, or abusive
   - **Incomplete** — missing crucial information (steps to reproduce, logs, version, etc.)
   - **Not reproducible** — the described behavior cannot be replicated
   - **Duplicate** — already reported in another open or closed issue
   - **Off-topic** — not relevant to this project
   - **Valid** — a legitimate bug report, feature request, or improvement

4. **Make a decision**
   - If **invalid** (spam, duplicate, incomplete, not reproducible, off-topic):
     Close the issue with a comment explaining why:
     ```bash
     gh issue close <issueNumber> --comment "<your kind, helpful explanation>"
     ```
     Return `{ action: "closed", reason: "<short reason>" }`.
   - If **valid**:
     Add a "triage" label so maintainers know it has been reviewed:
     ```bash
     gh issue edit <issueNumber> --add-label "triage"
     ```
     Return `{ action: "triaged", reason: "valid issue" }`.
