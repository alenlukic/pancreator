import assert from 'node:assert/strict'
import { createCipheriv, pbkdf2Sync } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  copilotCredentialReport,
  resolveCopilotCredential,
} from '../../src/lib/executors/copilot-cli.js'
import {
  openAiAuthenticationReadiness,
  resolveOpenAiApiKey,
} from '../../src/lib/executors/openai-auth.js'
import {
  resolveVsCodeOpenAiKey,
  type VsCodeSecretStorageAccess,
} from '../../src/lib/executors/vscode-openai-auth.js'
import { createTestTempDirectory } from '../temp.js'

const SECRET = 'sk-synthetic-vscode-fixture'
const PASSWORD = 'synthetic-safe-storage-password\n'
const REFERENCE = '${input:chat.lm.secret.-40b9692f}'
const VARIABLES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'PANCREATOR_OPENAI_KEY_SOURCE',
] as const

function withEnvironment(
  environment: Record<string, string>,
  run: (root: string) => void,
): void {
  const original = VARIABLES.map((name) => process.env[name])

  for (const name of VARIABLES) {
    delete process.env[name]
  }

  Object.assign(process.env, environment)

  try {
    run(createTestTempDirectory('vscode-auth-'))
  } finally {
    VARIABLES.forEach((name, index) => {
      const value = original[index]

      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    })
  }
}

function encrypted(secret: unknown = SECRET, json: boolean = true): string {
  const cipher = createCipheriv(
    'aes-128-cbc',
    pbkdf2Sync(PASSWORD, 'saltysalt', 1003, 16, 'sha1'),
    Buffer.alloc(16, 32),
  )

  return JSON.stringify(
    Buffer.concat([
      Buffer.from('v10'),
      cipher.update(json ? JSON.stringify(secret) : String(secret)),
      cipher.final(),
    ]),
  )
}

function fixture(): {
  access: VsCodeSecretStorageAccess
  calls: { binary: string; args: string[] }[]
  reads: string[]
} {
  const calls: { binary: string; args: string[] }[] = []
  const reads: string[] = []

  return {
    calls,
    reads,
    access: {
      platform: 'darwin',
      home: '/synthetic-home',
      read: (file) => {
        reads.push(file)

        return JSON.stringify([
          { vendor: 'anthropic', apiKey: '${input:unrelated}' },
          { vendor: 'openai', apiKey: REFERENCE },
        ])
      },
      run: (binary, args) => {
        calls.push({ binary, args })

        return binary === '/usr/bin/sqlite3' ? encrypted() : `${PASSWORD}\n`
      },
    },
  }
}

test('VS Code decrypts only the exact OpenAI reference with bounded local commands', () => {
  const { access, calls, reads } = fixture()
  const resolved = resolveVsCodeOpenAiKey(access)

  assert.equal(resolved?.key, SECRET)
  assert.deepEqual(reads, [
    '/synthetic-home/Library/Application Support/Code/User/chatLanguageModels.json',
  ])
  assert.deepEqual(calls, [
    {
      binary: '/usr/bin/sqlite3',
      args: [
        '-readonly',
        '-noheader',
        '/synthetic-home/Library/Application Support/Code/User/globalStorage/state.vscdb',
        "SELECT value FROM ItemTable WHERE key = 'secret://chat.lm.secret.-40b9692f';",
      ],
    },
    {
      binary: '/usr/bin/security',
      args: ['find-generic-password', '-s', 'Code Safe Storage', '-w'],
    },
  ])
  assert.ok(!JSON.stringify(calls).includes(SECRET))
  assert.ok(!JSON.stringify(calls).includes(PASSWORD))
})

test('VS Code accepts the plain text credential stored by the editor', () => {
  const { access } = fixture()
  const run = access.run

  access.run = (binary, args) =>
    binary === '/usr/bin/sqlite3' ? encrypted(SECRET, false) : run(binary, args)

  assert.equal(resolveVsCodeOpenAiKey(access)?.key, SECRET)
})

test('VS Code storage is untouched without exact opt-in', () => {
  for (const selector of [undefined, 'VSCode', ' vscode', 'other']) {
    withEnvironment(
      selector === undefined ? {} : { PANCREATOR_OPENAI_KEY_SOURCE: selector },
      (root) => {
        const { access, calls, reads } = fixture()

        assert.equal(resolveOpenAiApiKey(root, access).key, null)
        assert.equal(
          openAiAuthenticationReadiness(root, access).key_available,
          false,
        )
        assert.deepEqual(calls, [])
        assert.deepEqual(reads, [])
      },
    )
  }
})

test('process and dotenv keys outrank an opted-in VS Code fallback', () => {
  for (const fromProcess of [true, false]) {
    withEnvironment(
      {
        PANCREATOR_OPENAI_KEY_SOURCE: 'vscode',
        ...(fromProcess ? { OPENAI_API_KEY: 'process-key' } : {}),
      },
      (root) => {
        writeFileSync(path.join(root, '.env'), 'OPENAI_API_KEY=dotenv-key\n')
        const { access, calls, reads } = fixture()
        const resolved = resolveOpenAiApiKey(root, access)

        assert.equal(resolved.key, fromProcess ? 'process-key' : 'dotenv-key')
        assert.equal(
          resolved.source,
          fromProcess ? 'process_environment' : 'dotenv',
        )
        assert.deepEqual(calls, [])
        assert.deepEqual(reads, [])
      },
    )
  }
})

test('dotenv opt-in works and an explicit process selector takes precedence', () => {
  withEnvironment({}, (root) => {
    writeFileSync(
      path.join(root, '.env'),
      'PANCREATOR_OPENAI_KEY_SOURCE=vscode\n',
    )
    const { access, calls } = fixture()

    assert.equal(
      resolveOpenAiApiKey(root, access).source,
      'vscode_secret_storage',
    )
    assert.equal(calls.length, 2)
    process.env.PANCREATOR_OPENAI_KEY_SOURCE = 'disabled'
    assert.equal(resolveOpenAiApiKey(root, access).key, null)
    assert.equal(calls.length, 2)
  })
})

test('readiness and Copilot reports expose source only, while launch receives the key', () => {
  withEnvironment({ PANCREATOR_OPENAI_KEY_SOURCE: 'vscode' }, (root) => {
    const { access } = fixture()
    const readiness = openAiAuthenticationReadiness(root, access)
    const result = resolveCopilotCredential(root, 'openai', access)

    assert.equal(readiness.key_available, true)
    assert.equal(readiness.source, 'vscode_secret_storage')
    assert.deepEqual(readiness.advisories, [])
    assert.equal(result.ok, true)

    if (!result.ok) {
      assert.fail('Expected synthetic credential')
    }

    assert.equal(result.credential.environment.COPILOT_PROVIDER_API_KEY, SECRET)
    assert.equal(result.credential.secret, SECRET)
    const report = copilotCredentialReport(result.credential)

    assert.equal(report.source, 'vscode_secret_storage')
    const serialized = JSON.stringify({ readiness, report })

    assert.ok(!serialized.includes(SECRET))
    assert.ok(!serialized.includes(PASSWORD))
    assert.doesNotMatch(serialized, /ciphertext|"length"|"data"/u)
  })
})

test('other Copilot providers never consult VS Code OpenAI storage', () => {
  withEnvironment({ PANCREATOR_OPENAI_KEY_SOURCE: 'vscode' }, (root) => {
    const { access, reads, calls } = fixture()

    assert.equal(resolveCopilotCredential(root, 'github', access).ok, true)
    assert.equal(resolveCopilotCredential(root, 'anthropic', access).ok, false)
    assert.deepEqual(reads, [])
    assert.deepEqual(calls, [])
  })
})

test('unsupported platforms never read storage or invoke Keychain', () => {
  for (const platform of ['linux', 'win32']) {
    const { access, reads, calls } = fixture()

    access.platform = platform
    assert.equal(resolveVsCodeOpenAiKey(access), null)
    assert.deepEqual(reads, [])
    assert.deepEqual(calls, [])
  }
})

test('invalid, ambiguous and unsafe model references are rejected before commands', () => {
  const configurations: unknown[] = [
    {},
    [],
    [{ vendor: 'OpenAI', apiKey: REFERENCE }],
    [
      { vendor: 'openai', apiKey: REFERENCE },
      { vendor: 'openai', apiKey: REFERENCE },
    ],
    ...[
      SECRET,
      '${input:../../outside}',
      '${input:chat.lm.secret../outside}',
      "${input:chat.lm.secret.' OR 1=1--}",
      '${input:chat.lm.secret.}',
      '${input:chat.lm.secret.a}\n',
    ].map((apiKey) => [{ vendor: 'openai', apiKey }]),
  ]

  for (const configuration of configurations) {
    const { access, calls } = fixture()

    access.read = () => JSON.stringify(configuration)
    assert.equal(resolveVsCodeOpenAiKey(access), null)
    assert.deepEqual(calls, [])
  }
})

test('missing, oversized and malformed storage fails safely before Keychain', () => {
  for (const stored of [
    null,
    '',
    'not-json',
    'x'.repeat(1024 * 1024 + 1),
    JSON.stringify({ type: 'Buffer', data: [-1, 256, 0.5] }),
    JSON.stringify(Buffer.from('v11unsupported')),
    JSON.stringify(Buffer.from('v10invalid-block')),
    `${encrypted()}\n${encrypted()}`,
  ]) {
    const { access, calls } = fixture()

    access.run = (binary, args) => {
      calls.push({ binary, args })

      return stored
    }
    assert.equal(resolveVsCodeOpenAiKey(access), null)
    assert.equal(calls.length, 1)
  }
})

test('decryption errors, Keychain denial and invalid secret values remain secret-free', () => {
  for (const failure of [
    'denied',
    'throws',
    'wrong-password',
    'invalid-json',
    'empty',
    'object',
    'newline',
  ]) {
    withEnvironment({ PANCREATOR_OPENAI_KEY_SOURCE: 'vscode' }, (root) => {
      const { access } = fixture()
      const run = access.run

      access.run = (binary, args) => {
        if (binary === '/usr/bin/security') {
          if (failure === 'throws') {
            throw new Error(`${SECRET}:${PASSWORD}`)
          }

          if (failure === 'denied') {
            return null
          }

          if (failure === 'wrong-password') {
            return 'incorrect-password\n'
          }
        }

        if (binary === '/usr/bin/sqlite3') {
          if (failure === 'invalid-json') {
            return encrypted('not-json', false)
          }

          if (failure === 'empty') {
            return encrypted('')
          }

          if (failure === 'object') {
            return encrypted({ key: SECRET })
          }

          if (failure === 'newline') {
            return encrypted(`${SECRET}\n`)
          }
        }

        return run(binary, args)
      }

      assert.equal(resolveOpenAiApiKey(root, access).key, null)
      const readiness = openAiAuthenticationReadiness(root, access)
      const copilot = resolveCopilotCredential(root, 'openai', access)
      const serialized = JSON.stringify({ readiness, copilot })

      assert.equal(readiness.key_available, false)
      assert.equal(copilot.ok, false)
      assert.ok(
        readiness.advisories.some((value) =>
          value.includes('unavailable or unsupported'),
        ),
      )
      assert.ok(!serialized.includes(SECRET))
      assert.ok(!serialized.includes(PASSWORD))
      assert.doesNotMatch(serialized, /incorrect-password|bad decrypt/u)
    })
  }
})

test('file failures and malformed model JSON do not escape the resolver', () => {
  for (const text of ['{', 'x'.repeat(1024 * 1024 + 1), null]) {
    const { access, calls } = fixture()

    access.read = () => {
      if (text === null) {
        throw new Error(SECRET)
      }

      return text
    }
    assert.equal(resolveVsCodeOpenAiKey(access), null)
    assert.deepEqual(calls, [])
  }
})
