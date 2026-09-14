import { appendFileSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'

/**
 * Deterministic stand-in for the OpenAI Responses endpoint, run as its own
 * process.
 *
 * It cannot be an in-process server: `delegateInvocation` reaches the executor
 * through `spawnSync`, which blocks the test's event loop for the whole
 * delegation, so a listener in the test process would never answer.
 *
 * The script file names one turn per request. The server appends every
 * request body it receives to the record file, so a test can assert delivery
 * fidelity and conversation shape after the delegation returns.
 */

export interface FakeToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface FakeTurn {
  /** Tool calls the model asks for this turn. */
  tool_calls?: FakeToolCall[]
  /** Final assistant message. Ends the loop. */
  text?: string
  /** HTTP status to answer with instead of a normal body. */
  status?: number
  /** Error message the failing body carries. */
  error?: string
  /** Echo the received bearer token inside the error body. */
  echo_key?: boolean
  /** Hold the response open this long before answering. */
  delay_ms?: number
  /** Serve this turn again for every later request. */
  repeat?: boolean
}

export interface FakeScript {
  turns: FakeTurn[]
  /**
   * Fail any request whose input carries this text. Used to script a
   * continuation failure without depending on request ordering.
   */
  fail_if_input_contains?: string
}

function turnBody(turn: FakeTurn, index: number): Record<string, unknown> {
  const output: Record<string, unknown>[] = []

  for (const [callIndex, call] of (turn.tool_calls ?? []).entries()) {
    output.push({
      type: 'function_call',
      call_id: `call_${index}_${callIndex}`,
      name: call.name,
      arguments: JSON.stringify(call.arguments),
    })
  }

  if (turn.text !== undefined) {
    output.push({
      type: 'message',
      content: [{ type: 'output_text', text: turn.text }],
    })
  }

  return {
    id: `resp_${index}`,
    model: 'gpt-6-astra',
    status: 'completed',
    output,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  }
}

function inputText(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return ''
  }

  const input = (body as { input?: unknown }).input

  return Array.isArray(input) ? JSON.stringify(input) : String(input ?? '')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function main(): void {
  const scriptPath = process.env.FAKE_OPENAI_SCRIPT ?? ''
  const recordPath = process.env.FAKE_OPENAI_RECORD ?? ''
  const script = JSON.parse(readFileSync(scriptPath, 'utf8')) as FakeScript
  let received = 0

  const server = createServer((request, response) => {
    const chunks: Buffer[] = []

    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      void (async () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let body: unknown

        try {
          body = JSON.parse(raw)
        } catch {
          body = raw
        }

        const index = received
        const authorization = String(request.headers.authorization ?? '')

        received += 1

        if (recordPath.length > 0) {
          appendFileSync(
            recordPath,
            `${JSON.stringify({ index, authorization_present: authorization.length > 0, body })}\n`,
          )
        }

        const failMarker = script.fail_if_input_contains

        if (failMarker !== undefined && inputText(body).includes(failMarker)) {
          response.writeHead(400, { 'Content-Type': 'application/json' })
          response.end(
            JSON.stringify({
              error: { message: 'no conversation found for continuation' },
            }),
          )
          return
        }

        const last = script.turns.at(-1)
        const turn =
          script.turns[index] ??
          (last?.repeat === true
            ? last
            : { text: 'the script ran out of turns' })

        if (turn.delay_ms !== undefined) {
          await delay(turn.delay_ms)
        }

        if (turn.status !== undefined) {
          const message = turn.echo_key
            ? `${turn.error ?? 'request rejected'} (token ${authorization.replace('Bearer ', '')})`
            : (turn.error ?? 'request rejected')

          response.writeHead(turn.status, {
            'Content-Type': 'application/json',
          })
          response.end(JSON.stringify({ error: { message } }))
          return
        }

        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(turnBody(turn, index)))
      })()
    })
  })

  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    process.stdout.write(`http://127.0.0.1:${port}/v1/responses\n`)
  })
}

main()
