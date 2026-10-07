import { randomUUID } from 'node:crypto';
import { AtermError, uiRequest, type UIRequest } from '@garage49/aterm-core';

export const uiTargetOptions = [
  ['--session <id>', 'Target Session UUID or unique prefix of at least six hexadecimal characters'],
  [
    '--command-id <uuid>',
    'Reuse a command UUID to inspect/retry the same request without another delivery',
  ],
] as const;
export function prepareUI(input: Record<string, unknown>, controlled = false): UIRequest {
  const result = uiRequest.safeParse(
    controlled ? { ...input, id: input.id ?? randomUUID() } : input,
  );
  if (!result.success) throw new AtermError('ui.request', result.error.message);
  return result.data;
}
