// Errors that are expected and should be shown to the user as a plain message,
// without a stack trace.
export class FwdError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'FwdError';
  }
}
