import assert from 'node:assert/strict'
import test from 'node:test'

import { SECRET_PATH_PATTERN } from '../../src/lib/release-preparation.js'

// The corpus is the rule's contract: a shape the release check must name, and
// a shape it must leave alone. `credentials.txt` below proves the wiring from
// this pattern to RELEASE_PATH_UNSAFE, so the table stays at the rule.
const SECRET_PATHS = [
  '.env',
  '.env.production',
  '.env/production',
  'config/.env/keys.json',
  'certs/server.pem',
  'certs/server.key',
  'keys/client.p12',
  '.ssh/id_rsa',
  'id_ed25519',
  'credentials.txt',
  'deploy/service-account-token.json',
  'config/private_key.json',
]

const NON_SECRET_PATHS = [
  'docs/environment.md',
  'src/lib/env.ts',
  'library/templates/env.example.json',
  '.ssh/id_rsa.pub',
  'src/lib/keyboard.ts',
  'package-lock.json',
  'release/index.json',
  'governance/handbooks/eng/engineering.md',
]

test('the secret-path detector names every secret shape and no ordinary path', () => {
  for (const candidate of SECRET_PATHS) {
    assert.ok(
      SECRET_PATH_PATTERN.test(candidate),
      `${candidate} MUST be named as a secret-like path`,
    )
  }

  for (const candidate of NON_SECRET_PATHS) {
    assert.ok(
      !SECRET_PATH_PATTERN.test(candidate),
      `${candidate} MUST NOT be named as a secret-like path`,
    )
  }
})
