import { createRequire } from 'node:module';

/** Installed package metadata shared by CLI and MCP process adapters. */
export const { version: packageVersion } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};
