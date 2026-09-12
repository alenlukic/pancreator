/**
 * The one name the harness and the test reporters must agree on.
 *
 * This lives apart from `suite-profile.ts` because the reporters run inside
 * every test process. Reading the name from that module put its imports,
 * and so the run layout, into the import closure of the fixture helpers,
 * which selected fixture-only tests for changes they cannot observe.
 */

/** Environment variable the reporters read for their profile target. */
export const TEST_PROFILE_ENV = 'PAN_TEST_PROFILE'
