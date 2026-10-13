/**
 * An error whose message is safe to show to the end user.
 * Anything that is not a UserFacingError is logged and reported as a generic 500.
 */
export class UserFacingError extends Error {
  /**
   * @param {number} status HTTP status to respond with
   * @param {string} message Text shown to the user
   * @param {object} [options] Standard Error options (e.g. `cause`)
   */
  constructor(status, message, options) {
    super(message, options);
    this.name = 'UserFacingError';
    this.status = status;
  }
}
