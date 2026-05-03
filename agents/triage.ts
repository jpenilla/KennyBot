import type { FlueContext } from '@flue/sdk/client';
import { defineCommand } from '@flue/sdk/node';
import { Octokit } from '@octokit/rest';
import * as v from 'valibot';

// Single object schema — simpler than a discriminated union and more forgiving
// of how LLMs format JSON in their responses.
const TriageResultSchema = v.object({
  decision: v.picklist(['valid', 'invalid', 'duplicate', 'done']),
  comment: v.optional(v.string()),
  duplicateOf: v.optional(v.number()),
  tags: v.optional(v.array(v.string()), []),
});

// `gh` is granted to the skill for read/search only — the skill instructions
// never ask the agent to close or edit issues. Write operations are handled
// programmatically via Octokit after the agent returns a structured decision.
const gh = defineCommand('gh', {
  env: {
    GH_TOKEN: process.env.GH_TOKEN,
  },
});

export const triggers = {};

export default async function ({ init, payload }: FlueContext) {
  const ghToken = process.env.GH_TOKEN;
  if (!ghToken) throw new Error('GH_TOKEN is required');

  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!repoFull) throw new Error('GITHUB_REPOSITORY is required');
  const [owner, repo] = repoFull.split('/');

  const octokit = new Octokit({ auth: ghToken });

  // Fetch issue details and repo labels in parallel
  const [{ data: issue }, { data: labels }] = await Promise.all([
    octokit.issues.get({
      owner,
      repo,
      issue_number: payload.issueNumber,
    }),
    octokit.issues.listLabelsForRepo({
      owner,
      repo,
    }),
  ]);

  const repoLabels = labels.map((l) => l.name);

  const agent = await init({
    sandbox: 'local',
    model: payload.model ?? 'opencode-go/deepseek-v4-flash',
  });
  const session = await agent.session();

  // Agent analyzes the issue and returns a structured decision.
  // The skill has read-only gh access (search duplicates, view details).
  const result = await session.skill('kennybot-triage', {
    args: {
      issueNumber: payload.issueNumber,
      issueTitle: issue.title,
      issueBody: issue.body ?? '',
      issueAuthor: issue.user?.login ?? 'unknown',
      repoLabels: repoLabels.join(', '),
    },
    commands: [gh],
    result: TriageResultSchema,
  });

  // Act on the decision programmatically
  const tags = result.tags ?? [];

  switch (result.decision) {
    case 'valid': {
      if (tags.length > 0) {
        await octokit.issues.addLabels({
          owner,
          repo,
          issue_number: payload.issueNumber,
          labels: tags,
        });
      }
      break;
    }
    case 'invalid': {
      if (tags.length > 0) {
        await octokit.issues
          .addLabels({ owner, repo, issue_number: payload.issueNumber, labels: tags })
          .catch(() => {});
      }
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: payload.issueNumber,
        body: result.comment || 'This issue has been closed as invalid.',
      });
      await octokit.issues.update({
        owner,
        repo,
        issue_number: payload.issueNumber,
        state: 'closed',
      });
      break;
    }
    case 'duplicate': {
      const body = result.comment
        ? `${result.comment}\n\nDuplicate of #${result.duplicateOf}`
        : `Duplicate of #${result.duplicateOf}`;
      if (tags.length > 0) {
        await octokit.issues
          .addLabels({ owner, repo, issue_number: payload.issueNumber, labels: tags })
          .catch(() => {});
      }
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: payload.issueNumber,
        body,
      });
      await octokit.issues.update({
        owner,
        repo,
        issue_number: payload.issueNumber,
        state: 'closed',
      });
      break;
    }
    case 'done': {
      if (tags.length > 0) {
        await octokit.issues
          .addLabels({ owner, repo, issue_number: payload.issueNumber, labels: tags })
          .catch(() => {});
      }
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: payload.issueNumber,
        body: result.comment || 'This issue appears to have already been addressed.',
      });
      await octokit.issues.update({
        owner,
        repo,
        issue_number: payload.issueNumber,
        state: 'closed',
      });
      break;
    }
  }

  return result;
}
