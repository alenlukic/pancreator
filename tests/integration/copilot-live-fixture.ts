import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { COPILOT_CLI_REQUIRED_FLAGS } from '../../src/lib/executors/copilot-cli.js'
import { COPILOT_RELAY_LIMITS } from '../../src/lib/executors/copilot-relay.js'
import type { DelegationLiveIdentity } from '../../src/lib/executors/delegation-live.js'
import { createTestTempDirectory } from '../temp.js'

/** Creates a controllable Copilot CLI stub and its isolated live identity. */
export function setup(
  role = 'stage',
  root = createTestTempDirectory('copilot-live-'),
): {
  root: string
  binary: string
  identity: DelegationLiveIdentity
} {
  mkdirSync(root, { recursive: true })
  const binary = path.join(root, 'copilot')
  writeFileSync(
    binary,
    `#!${process.execPath}
import fs from 'node:fs'
import net from 'node:net'
import {spawn} from 'node:child_process'
if (process.argv.includes('--version')) { console.log('GitHub Copilot CLI 1.0.90'); process.exit(0) }
if (process.argv.includes('--help')) { console.log(${JSON.stringify(COPILOT_CLI_REQUIRED_FLAGS.join(' '))}); process.exit(0) }
if (process.env.CLI_STARTED) fs.writeFileSync(process.env.CLI_STARTED, String(process.pid))
const input = []
for await (const chunk of process.stdin) input.push(chunk)
const mode = process.env.STUB_MODE
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
const session = process.argv.find(arg => arg.startsWith('--session-id='))?.slice('--session-id='.length)
if (mode === 'frame-at-limit') {
  const event = {type:'tool.execution_complete',data:{toolCallId:'boundary',result:{content:''}}}
  event.data.result.content = 'x'.repeat(${COPILOT_RELAY_LIMITS.frameCharacters} - JSON.stringify(event).length)
  emit(event)
  emit({type:'result',sessionId:session,exitCode:0})
} else if (mode === 'large-frame') {
  emit({type:'session.info',ephemeral:true,data:{infoType:'configuration',message:'ready'}})
  emit({type:'tool.execution_complete',id:'tool-event',timestamp:new Date().toISOString(),data:{toolCallId:'view-1',success:true,result:{content:'x'.repeat(1024 * 1024) + process.env.GITHUB_TOKEN}}})
  const socket = net.connect(Number(process.env.HANDSHAKE), '127.0.0.1')
  socket.on('data', () => {
    emit({type:'result',sessionId:session,exitCode:0})
    socket.end(); process.exit(0)
  })
} else if (mode === 'timeout') {
  emit({type:'session.start',data:{sessionId:session}})
  process.on('SIGTERM', () => {})
  setInterval(() => {}, 1000)
} else if (mode === 'descendant') {
  const descendant = spawn(process.execPath, ['-e', "process.send(process.pid);process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {stdio:['ignore',1,2,'ipc']})
  descendant.on('message', pid => {
    fs.writeFileSync(process.env.DESCENDANT, String(pid))
    emit({type:'result',sessionId:session,exitCode:0})
    process.exit(0)
  })
} else if (['bounded', 'frame-bound', 'event-bound'].includes(mode)) {
  const descendant = spawn(process.execPath, ['-e', "process.send(process.pid);process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {stdio:['ignore',1,2,'ipc']})
  descendant.on('message', pid => {
    fs.writeFileSync(process.env.DESCENDANT, String(pid))
    process.stdout.write(mode === 'event-bound' ? '{}\\n'.repeat(100) : 'x'.repeat(mode === 'frame-bound' ? ${COPILOT_RELAY_LIMITS.frameCharacters + 1} : 300000))
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1000)
  })
} else if (mode === 'no-result') {
  emit({type:'assistant.message',data:{content:'incomplete'}})
} else if (mode === 'missing-session' || mode === 'wrong-session') {
  emit({type:'session.start',data:{sessionId:session}})
  emit({type:'result',sessionId:mode === 'wrong-session' ? 'other-session' : undefined,exitCode:0})
} else {
  const secret = process.env.GITHUB_TOKEN
  const events = [
    {type:'session.start',data:{sessionId:session}},
    {type:'assistant.message',data:{model:'test-model',content:'hello ☃ ' + secret}},
    {type:'tool.execution_start',data:{toolName:'view'}},
    {type:'tool.execution_complete',data:{result:secret}},
    {type:'result',sessionId:session,exitCode:0},
  ]
  for (const event of events) {
    const bytes = Buffer.from(JSON.stringify(event) + '\\n')
    for (let i = 0; i < bytes.length; i++) {
      process.stdout.write(bytes.subarray(i,i+1))
      await new Promise(resolve => setImmediate(resolve))
    }
  }
  process.stdout.write('malformed ' + secret + '\\n')
  process.stderr.write('diagnostic ' + secret + '\\n')
  process.stderr.write(Buffer.concat(input).toString() + '\\n')
  const socket = net.connect(Number(process.env.HANDSHAKE), '127.0.0.1')
  socket.on('data', () => {
    const destination = Buffer.concat(input).toString().split('Write your complete evidence report as Markdown to \`')[1]?.split('\`')[0]
    if (destination) fs.writeFileSync(destination, '# Fixture evidence\\n')
    socket.end(); process.exit(0)
  })
}
`,
  )
  // .mjs keeps the test stub independent of the scratch directory package type.
  const script = `${binary}.mjs`
  writeFileSync(script, readFileSync(binary))
  writeFileSync(
    binary,
    `#!/bin/bash\nexec "${process.execPath}" "${script}" "$@"\n`,
  )
  chmodSync(binary, 0o755)

  return {
    root,
    binary,
    identity: {
      run_id: 'run-1',
      invocation_id: 'inv-1',
      role,
      attempt: 2,
      launch_id: 'launch-1',
    },
  }
}
