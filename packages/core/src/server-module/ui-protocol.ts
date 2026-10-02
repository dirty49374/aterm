import { z } from 'zod';
import { referencePattern, qualifiedTermPattern } from '../syntax-module/identity.js';

export const uiId = z.uuidv4().toLowerCase();
const selector = z
  .string()
  .regex(
    /^(?:[0-9a-f]{6,32}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  );
const term = z.string().regex(new RegExp(`^${referencePattern}$`));
const canonicalTerm = z.string().regex(new RegExp(`^${qualifiedTermPattern}$`));
const terms = z.array(term).min(1).max(10000);
const target = { session: selector, id: uiId };

export const uiNoteInput = z
  .object({
    markdown: z
      .string()
      .max(65536)
      .refine((text) => !!text.trim(), 'Note Markdown must not be empty.'),
    title: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

/** Shared closed vocabulary: a UI instruction is never a corpus query or arbitrary script. */
export const uiRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('session-list') }).strict(),
  z.object({ operation: z.literal('session-view'), session: selector }).strict(),
  z.object({ operation: z.literal('command-view'), id: uiId }).strict(),
  z.object({ operation: z.literal('open'), ...target, terms: z.tuple([term]) }).strict(),
  z.object({ operation: z.literal('explore-set'), ...target, terms }).strict(),
  z.object({ operation: z.literal('explore-add'), ...target, terms }).strict(),
  z.object({ operation: z.literal('explore-remove'), ...target, terms }).strict(),
  z.object({ operation: z.literal('explore-clear'), ...target }).strict(),
  z.object({ operation: z.literal('note-send'), ...target, ...uiNoteInput.shape }).strict(),
]);
export type UIRequest = z.infer<typeof uiRequest>;
export type UIInstruction = Exclude<
  UIRequest,
  { operation: 'session-list' | 'session-view' | 'command-view' }
>;

export const uiState = z
  .object({
    location: z.string().startsWith('/').max(8192),
    view: z.enum(['term-declarations', 'references', 'graph', 'diagnostics', 'graphql']),
    term: z.union([canonicalTerm, z.literal('')]),
    mode: z.enum(['structure', 'explore']),
    terms: z.array(canonicalTerm).max(10000),
    selection: z.array(z.string().max(1024)).max(10000),
    revision: z.number().int().nonnegative(),
    corpusRevision: z.number().int(),
    busy: z.boolean(),
    visible: z.boolean(),
    notes: z
      .object({
        active: uiId.nullable(),
        count: z.number().int().min(0).max(10),
        open: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type UIState = z.infer<typeof uiState>;
const error = z.object({ code: z.string().max(100), message: z.string().max(8192) }).strict();
export const uiBrowserMessage = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('hello'),
      createdAt: z.iso.datetime(),
      lastActiveAt: z.iso.datetime(),
      id: uiId,
      credential: uiId,
      instance: uiId,
      home: z.string(),
      protocol: z.number(),
      state: uiState,
    })
    .strict(),
  z.object({ type: z.literal('state'), state: uiState, active: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('ack'),
      id: uiId,
      status: z.enum(['applied', 'failed']),
      state: uiState,
      error: error.optional(),
    })
    .strict(),
]);
export type UIBrowserMessage = z.infer<typeof uiBrowserMessage>;
export interface IUISession {
  readonly id: string;
  readonly shortId: string;
  readonly status: 'ready' | 'busy' | 'disconnected';
  readonly createdAt: string;
  readonly lastActiveAt: string;
  readonly lastSeenAt: string;
  readonly state: UIState;
}
export interface IUICommand {
  readonly id: string;
  readonly session: string;
  readonly request: UIInstruction;
  readonly createdAt: string;
  status: 'pending' | 'applied' | 'failed' | 'unknown';
  completedAt?: string;
  state?: UIState;
  error?: { code: string; message: string };
}
export type UIResult =
  | { operation: 'session-list'; sessions: IUISession[] }
  | { operation: 'session-view'; session: IUISession }
  | { operation: 'command-view' | UIInstruction['operation']; command: IUICommand };

export const compactId = (id: string): string => id.replaceAll('-', '').toLowerCase();
export function shortSessionId(id: string, ids: readonly string[]): string {
  const compact = compactId(id);
  let length = 6;
  while (
    length < compact.length &&
    ids.some((other) => other !== id && compactId(other).startsWith(compact.slice(0, length)))
  )
    length++;
  return compact.slice(0, length);
}
