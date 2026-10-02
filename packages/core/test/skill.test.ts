import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { expect, test } from 'vitest';
import { AtermDispatch, AtermServer, type ISkillResult } from '../src/index.js';
import { fixture } from './fixture.js';

const skill = (
  name: string,
  relations = '',
  body = `${name} instructions.`,
  reminder?: string,
) => `skill _${name}_ = {
  Knowledge for ${name}.
${
  relations
    ? '.relations\n' +
      relations
        .split('\n')
        .map((r) => '  ' + r)
        .join('\n') +
      '\n'
    : ''
}.description
  Use for ${name}.
.body
  ${body}
${
  reminder === undefined
    ? ''
    : '.reminder\n' +
      reminder
        .split('\n')
        .map((line) => '  ' + line)
        .join('\n') +
      '\n'
}
}
`;
async function setup(source: string, extraConfig = '') {
  const f = await fixture(`sources: [docs]\nviewpoints:\n  skill: ./skill.md\n${extraConfig}`);
  await f.write(
    '.aterm/skill.md',
    await readFile(new URL('../viewpoints/skill.md', import.meta.url), 'utf8'),
  );
  await f.write('docs/trial.trm', '@knowledge trial\n@viewpoints skill\n' + source);
  return f;
}

test('skill reads ordered shared prerequisites once without expanding their bodies', async () => {
  const f = await setup(
    skill('Base') +
      skill('Right', 'requires _Base_') +
      skill('Left', 'requires _Base_') +
      skill('Task', 'requires _Right_\nrequires _Left_\nderived_from _Source_') +
      'resource _Source_ = {\n  Authoritative source, not a prerequisite.\n}\n',
  );
  const app = await f.app();
  const list = (await app.query({ operation: 'skill-list', knowledge: 'trial' })) as ISkillResult;
  expect(list.skills.map((s) => s.term)).toEqual([
    '_trial:Base_',
    '_trial:Left_',
    '_trial:Right_',
    '_trial:Task_',
  ]);
  const view = (await app.query({
    operation: 'skill-view',
    skillTerms: ['_Task_', '_Base_', '_trial:Task_'],
  })) as ISkillResult;
  expect(view.skills.map((s) => s.term)).toEqual(['_trial:Task_', '_trial:Base_']);
  expect(view.skills[0]?.prerequisites).toEqual(['_trial:Base_', '_trial:Right_', '_trial:Left_']);
  expect(view.skills[0]?.markdown).toContain('Task instructions.');
  expect(view.skills[0]?.markdown).not.toContain('Base instructions.');
  expect(view.skills[0]?.markdown).not.toContain('_trial:Source_');
  expect(view.skills[0]?.markdown).not.toContain('## Prerequisite reading');
  expect(view.skills[0]?.markdown).not.toContain('## How to read Skills');
  expect(view.skills[0]?.markdown).not.toContain('aterm skill view');
  expect(view.skills[0]?.markdown).toMatch(/\n\n\n$/);
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
  await expect(app.query({ operation: 'skill-view' })).rejects.toThrow('Select at least one');
  await expect(app.query({ operation: 'skill-view', skillTerms: ['_Absent_'] })).rejects.toThrow(
    'unknown',
  );
  await expect(app.query({ operation: 'skill-list', searchText: 'ignored' })).rejects.toThrow(
    'does not accept',
  );
});

test('TOC is a SKILL.md entrypoint with a dependency-ordered batch command and no body or reminder', async () => {
  const f = await setup(
    skill('Base', '', 'Base teaching.', '- Base cue.') +
      skill('Right', 'requires _Base_') +
      skill('Left', 'requires _Base_') +
      skill('Task', 'requires _Right_\nrequires _Left_', 'Task teaching.', '- Task cue.'),
  );
  const app = await f.app();
  const toc = (await app.query({
    operation: 'skill-toc',
    skillTerms: ['_Task_', '_Base_', '_trial:Task_'],
  })) as ISkillResult;
  expect(toc.skills.map((s) => s.term)).toEqual(['_trial:Task_', '_trial:Base_']);
  const task = toc.skills[0]!;
  expect(task.prerequisites).toEqual(['_trial:Base_', '_trial:Right_', '_trial:Left_']);
  expect(task.markdown).toContain('# _trial:Task_\n\nKnowledge for Task.');
  expect(task.markdown).toContain('1. _trial:Base_\n2. _trial:Right_\n3. _trial:Left_');
  expect(task.markdown).toContain('## Skill reading\n\n_trial:Task_');
  const command = task.markdown!.match(/```sh\n([\s\S]*?)\n```/)![1]!;
  expect(command).toBe('aterm skill view _trial:Base_ _trial:Right_ _trial:Left_ _trial:Task_');
  expect(task.markdown).not.toContain('Task teaching.');
  expect(task.markdown).not.toContain('Task cue.');
  expect(task.markdown).not.toContain('Base teaching.');
  expect(task.markdown).toMatch(/\n\n\n$/);
  const base = toc.skills[1]!;
  expect(base.markdown).toContain('No prerequisite Skills.');
  expect(base.markdown).toContain('aterm skill view _trial:Base_\n```');
  const batch = (await app.query({
    operation: 'skill-view',
    skillTerms: [...task.prerequisites, task.term],
  })) as ISkillResult;
  expect(batch.skills.map((s) => s.term)).toEqual([
    '_trial:Base_',
    '_trial:Right_',
    '_trial:Left_',
    '_trial:Task_',
  ]);
  expect(batch.skills.at(-1)!.markdown).toContain('Task teaching.');
  expect(batch.skills.at(-1)!.markdown).toContain('## Reminder\n\n- Task cue.');
  expect(batch.skills.every((s) => !s.markdown!.includes('## Prerequisite reading'))).toBe(true);
  await expect(app.query({ operation: 'skill-toc' })).rejects.toThrow('Select at least one');
  await expect(app.query({ operation: 'skill-toc', skillTerms: ['_Unknown_'] })).rejects.toThrow(
    'unknown',
  );
  await expect(
    app.query({ operation: 'skill-toc', skillTerms: ['_Task_'], searchText: 'ignored?' }),
  ).rejects.toThrow('does not accept');
});

test('knowledge selection disambiguates roots without excluding cross-Knowledge prerequisites', async () => {
  const f = await setup(skill('Base') + skill('Task', 'requires _Base_'));
  await f.write(
    'docs/other.trm',
    '@knowledge other\n@viewpoints skill\n' + skill('Task', 'requires _trial:Base_'),
  );
  const app = await f.app();
  await expect(app.query({ operation: 'skill-view', skillTerms: ['_Task_'] })).rejects.toThrow(
    'ambiguous',
  );
  const view = (await app.query({
    operation: 'skill-view',
    skillTerms: ['_Task_'],
    knowledge: 'other',
  })) as ISkillResult;
  expect(view.skills[0]?.term).toBe('_other:Task_');
  expect(view.skills[0]?.prerequisites).toEqual(['_trial:Base_']);
  await expect(app.query({ operation: 'skill-toc', skillTerms: ['_Task_'] })).rejects.toThrow(
    'ambiguous',
  );
  const toc = (await app.query({
    operation: 'skill-toc',
    skillTerms: ['_Task_'],
    knowledge: 'other',
  })) as ISkillResult;
  expect(toc.skills[0]?.markdown).toContain('aterm skill view _trial:Base_');
  expect(toc.skills[0]?.markdown).toContain('## Skill reading\n\n_other:Task_');
  expect((await f.read({ operation: 'check', knowledge: 'other' })).diagnostics).toEqual([]);
});

test.each([
  [skill('A', 'requires _A_'), 'Prerequisite cycle'],
  [skill('A', 'requires _B_') + skill('B', 'requires _A_'), 'Prerequisite cycle'],
  [skill('A', 'requires _Source_') + 'resource _Source_ = { Source. }\n', 'must be a skill'],
  [skill('A').replace('.body\n  A instructions.\n', ''), 'nonempty .body'],
  [skill('A').replace('.description\n  Use for A.\n', ''), 'nonempty .description'],
  [skill('A', '', 'A instructions.', ''), 'authored .reminder section must be nonempty'],
])(
  'skill invalid declarations are refused by reads and corpus check (%#)',
  async (source, message) => {
    const f = await setup(source);
    await expect((await f.app()).query({ operation: 'skill-list' })).rejects.toThrow(message);
    expect(
      (await f.read({ operation: 'check' })).diagnostics.map((d) => d.message).join('\n'),
    ).toContain(message);
  },
);

test('requires belongs to its Term Declaration, while normal section transclusion remains available', async () => {
  const f = await setup(
    skill('Base') +
      skill('Task', 'references _Base_', '_Base_.body†') +
      'resource _Supporting_Resource_ = {\n  Another Term Declaration.\n.relations\n  requires _Source_\n}\nresource _Source_ = { Source. }\n',
  );
  const view = (await (
    await f.app()
  ).query({ operation: 'skill-view', skillTerms: ['_Task_'] })) as ISkillResult;
  expect(view.skills[0]?.prerequisites).toEqual([]);
  expect(view.skills[0]?.markdown).toContain('Base instructions.');
});

test('reminders read only selected cues, share section expansion with view, and preserve selection order', async () => {
  const f = await setup(
    skill('Base', '', 'Base explanation.', '- Base recall.') +
      skill(
        'Task',
        'requires _Base_\nreferences _Cue_',
        'Long task explanation.',
        '- Task recall.\n_Cue_.examples†',
      ) +
      'resource _Cue_ = {\n  Shared evidence.\n.examples\n  > Adjacent example.\n}\n',
  );
  const app = await f.app();
  const result = (await app.query({
    operation: 'skill-remind',
    skillTerms: ['_Task_', '_Base_', '_trial:Task_'],
  })) as ISkillResult;
  expect(result.skills.map((s) => s.term)).toEqual(['_trial:Task_', '_trial:Base_']);
  const task = result.skills[0]!;
  expect(task.hasReminder).toBe(true);
  expect(task.prerequisites).toEqual(['_trial:Base_']);
  expect(task.markdown).toContain('- Task recall.\n> Adjacent example.');
  expect(task.markdown).toContain('Full reading: aterm skill view _trial:Task_');
  expect(task.markdown).not.toContain('Base recall');
  expect(task.markdown).not.toContain('Long task explanation');
  expect(task.markdown).not.toContain('Prerequisite reading');
  expect(task.markdown).toMatch(/\n\n\n$/);
  const view = (await app.query({
    operation: 'skill-view',
    skillTerms: ['_Task_'],
  })) as ISkillResult;
  expect(view.skills[0]!.markdown).toContain('Long task explanation.');
  expect(view.skills[0]!.markdown).toContain('## Reminder\n\n- Task recall.\n> Adjacent example.');
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('a missing reminder is explicit and never substitutes the full body', async () => {
  const f = await setup(skill('Task', '', 'The long explanation must not be a fallback.'));
  const app = await f.app();
  const result = (await app.query({
    operation: 'skill-remind',
    skillTerms: ['_Task_'],
  })) as ISkillResult;
  expect(result.skills[0]!.hasReminder).toBe(false);
  expect(result.skills[0]!.markdown).toContain('No Reminder is authored');
  expect(result.skills[0]!.markdown).toContain('aterm skill view _trial:Task_');
  expect(result.skills[0]!.markdown).not.toContain('long explanation');
  await expect(app.query({ operation: 'skill-remind' })).rejects.toThrow('Select at least one');
  await expect(app.query({ operation: 'skill-remind', skillTerms: ['_Unknown_'] })).rejects.toThrow(
    'unknown',
  );
  await expect(
    app.query({ operation: 'skill-remind', skillTerms: ['_Task_'], searchText: 'ignored?' }),
  ).rejects.toThrow('does not accept');
});

test('reminder Knowledge selection is exact and advisory budgets never truncate authored cues', async () => {
  const cues = Array.from({ length: 25 }, (_, i) => `- Cue ${i + 1}.`).join('\n');
  const f = await setup(skill('Task', '', 'Task explanation.', cues));
  await f.write('docs/other.trm', '@knowledge other\n@viewpoints skill\n' + skill('Task'));
  const app = await f.app();
  await expect(app.query({ operation: 'skill-remind', skillTerms: ['_Task_'] })).rejects.toThrow(
    'ambiguous',
  );
  const result = (await app.query({
    operation: 'skill-remind',
    skillTerms: ['_Task_'],
    knowledge: 'trial',
  })) as ISkillResult;
  expect(result.skills[0]!.markdown).toContain(cues);
  expect((await f.read({ operation: 'check' })).diagnostics).toEqual([]);
});

test('skill read results are identical through HTTP dispatch and local execution', async () => {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  const f = await setup(
    skill('Base') + skill('Task', 'requires _Base_'),
    `server:\n  host: 127.0.0.1\n  port: ${port}\n`,
  );
  const app = await f.app();
  const server = new AtermServer(app.config);
  await server.start();
  try {
    for (const operation of ['skill-list', 'skill-toc', 'skill-view', 'skill-remind'] as const) {
      const query = {
        operation,
        ...(operation !== 'skill-list' ? { skillTerms: ['_Task_'] } : {}),
      };
      expect(await new AtermDispatch().query(app, query)).toEqual(await app.query(query));
    }
  } finally {
    await server.close();
  }
});
