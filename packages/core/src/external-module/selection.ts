import { z } from 'zod';

/** One named glob selection shared by configuration and explicit query overrides. */
export const externalSelectionShape = {
  externalSources: z
    .record(
      z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'Use a source name such as core or cli.'),
      z
        .string()
        .trim()
        .min(1)
        .refine(
          (value) => !/[\0\r\n\\]/.test(value) && !value.startsWith('!'),
          'Use a positive file glob with forward slashes.',
        ),
    )
    .optional(),
};
