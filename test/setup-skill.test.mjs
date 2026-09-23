import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const skillURL = new URL('../.agents/skills/setup-codex-local-hub/SKILL.md', import.meta.url);
const releaseWorkflowURL = new URL('../.github/workflows/release.yml', import.meta.url);

test('setup skill migrates legacy updater hosts with a data-preserving full upgrade', async () => {
  const skill = await readFile(skillURL, 'utf8');

  assert.match(skill, /api\.github\.com\/repos\/brandonwang001\/codex-local-hub\/releases\/latest/);
  assert.match(skill, /skip the core-only path and perform one complete release or source-build upgrade/);
  assert.match(skill, /Preserve `~\/Library\/Application Support\/Codex Local Hub`/);
  assert.match(skill, /timestamped sibling backup/);
  assert.match(skill, /api\.github\.com\/repos\/makorise\/codex-local-hub\/releases\/latest/);
  assert.match(skill, /no longer contains the obsolete endpoint/);
  assert.match(skill, /remove only `CodexLocalHubUpdateCheckedAt`/);
  assert.match(skill, /do not delete Application Support or task data/);
});

test('release guidance does not promise hot updates to legacy repository clients', async () => {
  const workflow = await readFile(releaseWorkflowURL, 'utf8');

  assert.doesNotMatch(workflow, /Existing v0\.2\.2 users can update safely/);
  assert.match(workflow, /Mac host already uses the Makorise release channel/);
  assert.match(workflow, /need one data-preserving full migration/);
});
