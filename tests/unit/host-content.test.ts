import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hostToolTranslations,
  loadHostToolRegistry,
} from '../../src/lib/host-tools.js'
import {
  renderCommandSkill,
  renderVscodeAgent,
  renderVscodeInstructions,
  translateHostToolNames,
} from '../../src/lib/projection/host-content.js'

test('a command renders as a slash-only skill named after its folder', () => {
  const skill = renderCommandSkill(
    'pan-resume',
    'Resume or advance Pancreator run `$ARGUMENTS`. Then report.\n\nMore.\n',
  )

  assert.equal(
    skill,
    [
      '---',
      'name: pan-resume',
      'description: "Resume or advance Pancreator run `$ARGUMENTS`."',
      'disable-model-invocation: true',
      '---',
      '',
      '`$ARGUMENTS` in these instructions stands for the text the operator typed after `/pan-resume`.',
      '',
      'Resume or advance Pancreator run `$ARGUMENTS`. Then report.\n\nMore.\n',
    ].join('\n'),
  )
  assert.doesNotMatch(
    renderCommandSkill('pan-x', 'Do it.\n'),
    /stands for the text/u,
  )
  assert.throws(() => renderCommandSkill('Pan_X', 'Do it.\n'), /MUST be/u)
})

test('a skill description joins a wrapped first sentence onto one line', () => {
  assert.match(
    renderCommandSkill(
      'pan-x',
      'Summarize the work so another agent\ncan continue it.\n',
    ),
    /^description: "Summarize the work so another agent can continue it\."$/mu,
  )
})

test('a persona renders as a hidden custom agent with its description', () => {
  const agent = renderVscodeAgent(
    'coder',
    '---\ndescription: Implements a plan.\nmodel: x\ntools: [Bash]\n---\n\nAdopt the persona.\n',
  )

  assert.equal(
    agent,
    '---\nname: pan-coder\ndescription: "Implements a plan."\nuser-invocable: false\n---\n\nAdopt the persona.\n',
  )
  assert.throws(
    () => renderVscodeAgent('coder', 'No frontmatter.\n'),
    /description/u,
  )
})

test('a Cursor rule renders as an instruction file for every request', () => {
  assert.equal(
    renderVscodeInstructions(
      '---\ndescription: Rules — title\nalwaysApply: true\n---\n\nBody.\n',
    ),
    '---\ndescription: "Rules — title"\napplyTo: \'**\'\n---\n\nBody.\n',
  )
})

test('projected prose names the host question tool', () => {
  const registry = loadHostToolRegistry(process.cwd())

  assert.deepEqual(hostToolTranslations(registry, 'cursor'), [])
  assert.equal(
    translateHostToolNames(
      'Use `cursor/ask_question` here; keep cursor/ask_question bare.',
      hostToolTranslations(registry, 'vscode'),
    ),
    'Use `vscode/askQuestions` here; keep cursor/ask_question bare.',
  )
})
