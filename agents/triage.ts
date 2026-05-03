import fs from 'node:fs/promises';
import type { FlueContext } from '@flue/sdk/client';
import { defineCommand } from '@flue/sdk/node';
import { Octokit } from '@octokit/rest';
import * as v from 'valibot';

const TriageResultSchema = v.object({
  decision: v.picklist(['valid', 'invalid', 'duplicate', 'done']),
  comment: v.optional(v.string()),
  duplicateOf: v.optional(v.number()),
  tags: v.optional(v.array(v.string()), []),
});

// `gh` is granted to the skill for read/search only. The skill instructions
// never ask the agent to close or edit issues. This job has `issues: read`
// permission, so write operations would fail anyway.
const gh = defineCommand('gh', {
  env: {
    GH_TOKEN: process.env.GH_TOKEN,
  },
});

export const triggers = {};

export default async function ({ init, payload }: FlueContext) {
  // Fetch issue details and repo labels via Octokit (read-only operations).
  // Write operations are handled separately by the process job.
  const ghToken = process.env.GH_TOKEN;
  if (!ghToken) throw new Error('GH_TOKEN is required');

  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!repoFull) throw new Error('GITHUB_REPOSITORY is required');
  const [owner, repo] = repoFull.split('/');

  const octokit = new Octokit({ auth: ghToken });

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

  const repoLabels = labels
    .map((l) => l.description ? `- ${l.name}: ${l.description}` : `- ${l.name}`)
    .join('\n');

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
      repoOwner: owner,
      repoName: repo,
    },
    commands: [gh],
    result: TriageResultSchema,
  });

  // Write result to a file if a path was provided. The action reads this file
  // instead of parsing flue's stdout, which contains build progress interleaved.
  if (payload._resultPath) {
    await fs.writeFile(payload._resultPath, JSON.stringify(result));
  }

  return result;
}
