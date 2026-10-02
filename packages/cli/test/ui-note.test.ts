import { expect, test, vi } from 'vitest';
import { UINoteSendCommand } from '../src/command-module/ui-note-send-command.js';

test('Note input uses the shared deferred file/stdin adapter and preserves Markdown', async () => {
  const definition = new UINoteSendCommand();
  const source = '# Notes\n\n```trm\nconcept _Term_ = { Literal. }\n```\n';
  const input = { text: vi.fn(async () => source), cwd: () => '/tmp' };
  for (const file of [undefined, '-', 'notes.md']) {
    const result = await definition.ui(
      [],
      { session: 'abcdef', file, title: ' Explanation ' },
      input,
    );
    expect(result).toMatchObject({
      operation: 'note-send',
      markdown: source,
      title: 'Explanation',
      session: 'abcdef',
    });
    expect(input.text).toHaveBeenLastCalledWith(file ?? '-');
  }
  await expect(
    definition.ui([], { session: 'abcdef' }, { ...input, text: async () => ' \n ' }),
  ).rejects.toThrow('empty');
  await expect(
    definition.ui([], { session: 'abcdef' }, { ...input, text: async () => 'a'.repeat(65537) }),
  ).rejects.toThrow();
});
