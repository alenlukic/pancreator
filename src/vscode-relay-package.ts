import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'

import { PanError } from './lib/errors.js'
import { fileExists, findProjectRoot, isRecord, readJson } from './lib/io.js'

function zip(entries: Map<string, Buffer>): Buffer {
  const files: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0

  for (const [name, body] of entries) {
    const filename = Buffer.from(name)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(0x21, 12)
    header.writeUInt32LE(crc32(body), 14)
    header.writeUInt32LE(body.length, 18)
    header.writeUInt32LE(body.length, 22)
    header.writeUInt16LE(filename.length, 26)
    files.push(header, filename, body)

    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4)
    header.copy(record, 6, 4, 30)
    record.writeUInt32LE(offset, 42)
    directory.push(record, filename)
    offset += header.length + filename.length + body.length
  }

  const central = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.size, 8)
  end.writeUInt16LE(entries.size, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...files, central, end])
}

/** Package a portable VSIX, including the dependency-free compiled relay runtime. */
export function packageVscodeRelay(root: string): string {
  const manifest = readJson(
    path.join(root, 'library/vscode/relay-extension.json'),
  )
  const packageValue = readJson(path.join(root, 'package.json'))

  if (
    !isRecord(manifest) ||
    !isRecord(packageValue) ||
    typeof packageValue.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(packageValue.version) ||
    !fileExists(path.join(root, 'dist/src/vscode-relay.js'))
  ) {
    throw new PanError(
      'Build the harness before packaging its VS Code relay.',
      {
        code: 'INVALID_RELAY_PACKAGE',
      },
    )
  }

  const version = packageValue.version
  const entries = new Map<string, Buffer>([
    [
      '[Content_Types].xml',
      Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>',
      ),
    ],
    [
      'extension.vsixmanifest',
      Buffer.from(
        `<?xml version="1.0"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="pancreator-reminder-relay" Version="${version}" Publisher="pancreator"/><DisplayName>Pancreator Reminder Relay</DisplayName><Description xml:space="preserve">Workspace reminder relay lifecycle</Description></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.105.0"/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/></Properties><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>`,
      ),
    ],
    [
      'extension/package.json',
      Buffer.from(`${JSON.stringify({ ...manifest, version }, null, 2)}\n`),
    ],
    [
      'extension/extension.cjs',
      readFileSync(path.join(root, 'library/vscode/relay-extension.cjs')),
    ],
  ])
  const runtime = path.join(root, 'dist/src')

  for (const filename of readdirSync(runtime, {
    recursive: true,
    encoding: 'utf8',
  }).sort()) {
    if (filename.endsWith('.js')) {
      entries.set(
        `extension/runtime/${filename.replaceAll(path.sep, '/')}`,
        readFileSync(path.join(runtime, filename)),
      )
    }
  }

  const output = path.join(
    root,
    'runtime/vscode/pancreator-reminder-relay.vsix',
  )
  mkdirSync(path.dirname(output), { recursive: true })
  const temporary = `${output}.${randomUUID()}.tmp`
  writeFileSync(temporary, zip(entries))
  renameSync(temporary, output)
  return output
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(packageVscodeRelay(findProjectRoot()))
}
