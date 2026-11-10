const vscode = require('vscode')

let activation

exports.activate = (context) => {
  activation = import('./runtime/vscode-relay.js').then(
    ({ activateRelayExtension }) => activateRelayExtension(vscode, context),
  )
  return activation
}

exports.deactivate = async () => {
  const lifecycle = await activation
  await lifecycle?.deactivate()
}
