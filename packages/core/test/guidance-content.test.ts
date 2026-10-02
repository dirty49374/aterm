import { expect, test } from 'vitest';
import { AtermApplication, type ISkillResult } from '../src/index.js';
import { packagedSkills } from './skill-fixture.js';
import { fixture } from './fixture.js';
test('packaged Skills all render separate entrypoints, actual bodies and short recall without legacy commands', async () => {
  const f = await fixture('sources: [docs]\nuseViewpoints: []\nuseDefaultKnowledge: false\n');
  const app = await f.app();
  const list = (await app.query({ operation: 'skill-list' })) as ISkillResult;
  expect(list.skills.map((s) => s.term).sort()).toEqual(packagedSkills.map((s) => s[1]).sort());
  for (const { term } of list.skills) {
    const read = async (operation: 'skill-toc' | 'skill-view' | 'skill-remind') =>
      ((await app.query({ operation, skillTerms: [term] })) as ISkillResult).skills[0]!.markdown!;
    const toc = await read('skill-toc'),
      body = await read('skill-view'),
      reminder = await read('skill-remind');
    expect(toc).toContain('## Skill reading');
    expect(body).not.toContain('## Prerequisite reading');
    expect(body).toContain('## Reminder');
    expect(reminder).toContain('Full reading: aterm skill view');
    expect(reminder.trimEnd().split('\n').length).toBeLessThanOrEqual(20);
    for (const text of [toc, body, reminder])
      expect(text).not.toMatch(/aterm (?:newskill|workflow) |skills\.source/);
  }
}, 30000);
