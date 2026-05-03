import type { FlueContext } from '@flue/sdk/client';
import { defineCommand } from '@flue/sdk/node';
import { Octokit } from '@octokit/rest';
import * as v from 'valibot';

const TriageResultSchema = v.union([
  v.object({
    decision: v.literal('valid'),
    tags: v.array(v.string()),
  }),
  v.object({
    decision: v.literal('invalid'),
    comment: v.string(),
    tags: v.array(v.string()),
  }),
  v.object({
    decision: v.literal('duplicate'),
    comment: v.string(),
    duplicateOf: v.number(),
    tags: v.array(v.string()),
  }),
  v.object({
    decision: v.literal('done'),
    comment: v.string(),
    tags: v.array(v.string()),
  }),
]);

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
  const agent = await init({
    sandbox: 'local',
    model: payload.model ?? 'opencode-go/deepseek-v4-flash',
  });
  const session = await agent.session();

  // Step 1: Agent analyzes the issue and returns a structured decision.
  // The skill has read-only gh access (search duplicates, view details).
  const result = await session.skill('kennybot-triage', {
    args: {
      issueNumber: payload.issueNumber,
      issueTitle: payload.issueTitle,
      issueBody: payload.issueBody,
      issueAuthor: payload.issueAuthor,
      repoLabels: payload.repoLabels,
    },
    commands: [gh],
    result: TriageResultSchema,
  });

  // Step 2: Act on the decision programmatically — no agent involvement.
  const ghToken = process.env.GH_TOKEN;
  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!ghToken) throw new Error('GH_TOKEN is required');
  if (!repoFull) throw new Error('GITHUB_REPOSITORY is required');
  const [owner, repo] = repoFull.split('/');
  const octokit = new Octokit({ auth: ghToken });

  switch (result.decision) {
    case 'valid': {
      if (result.tags.length > 0) {
        await octokit.issues.addLabels({
          owner,
          repo,
          issue_number: payload.issueNumber,
          labels: result.tags,
        });
      }
      break;
    }
    case 'invalid': {
      if (result.tags.length > 0) {
        await octokit.issues.addLabels({
          owner,
          repo,
          issue_number: payload.issueNumber,
          labels: result.tags,
        }).catch(() => {});
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
        ? `${result.comment}\n\n(Duplicate of #${result.duplicateOf})`
        : `Duplicate of #${result.duplicateOf}`;
      if (result.tags.length > 0) {
        await octokit.issues.addLabels({
          owner,
          repo,
          issue_number: payload.issueNumber,
          labels: result.tags,
        }).catch(() => {});
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
      if (result.tags.length > 0) {
        await octokit.issues.addLabels({
          owner,
          repo,
          issue_number: payload.issueNumber,
          labels: result.tags,
        }).catch(() => {});
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
