import type { FlueContext } from '@flue/sdk/client';
import { defineCommand } from '@flue/sdk/node';
import * as v from 'valibot';

// Connect the `gh` CLI to the agent without leaking the token.
// The agent can run `gh issue view`, `gh issue close`, etc.
// but never sees the GH_TOKEN itself.
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

  // Run the triage skill. The workflow stages the skill at .agents/skills/kennybot-triage/SKILL.md
  // in the consuming repo's checkout — either KennyBot's built-in default or a custom skill.
  const result = await session.skill('kennybot-triage', {
    args: {
      issueNumber: payload.issueNumber,
    },
    commands: [gh],
    result: v.object({
      action: v.picklist(['closed', 'triaged']),
      reason: v.string(),
    }),
  });

  return result;
}
