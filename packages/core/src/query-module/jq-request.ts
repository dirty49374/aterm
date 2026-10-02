import { z } from 'zod';

export const jqLimits = {
  programBytes: 64 * 1024,
  inputBytes: 16 * 1024 * 1024,
  outputBytes: 2 * 1024 * 1024,
  memoryBytes: 128 * 1024 * 1024,
  timeoutMs: 5000,
  concurrent: 4,
} as const;

export const jqBindings = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.json());

export const jqRequest = z
  .object({
    program: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, 'jq program must not be blank.'),
    knowledge: z.array(z.string().min(1)).nullish(),
    bindings: jqBindings.nullish(),
  })
  .strict();
export type JqRequest = z.infer<typeof jqRequest>;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export interface IJqResult {
  readonly operation: 'jq';
  /** One element for each jq output; empty, null and an array output stay distinct. */
  readonly values: readonly JsonValue[];
}
