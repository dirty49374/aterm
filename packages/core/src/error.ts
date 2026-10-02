/** The one error type every Aterm boundary throws; `code` is a stable machine-readable tag. */
export class AtermError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AtermError';
  }
}
