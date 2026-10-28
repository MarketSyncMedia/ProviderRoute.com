#!/usr/bin/env node
// Fails when src/types/database.generated.ts stops matching the schema the
// migrations actually produce.
//
// The committed file is the app's description of the database. Nothing used to
// verify it, so it drifted: on 2026-08-31 the hand-written types declared six
// organizations columns non-nullable that the database allows to be null, and
// typed two columns as unions the database does not constrain. The compiler was
// checking the app against a description rather than the schema.
//
// This regenerates from the disposable database that verify-database.mjs has
// already built from the migrations, so it needs no credentials and no network:
// it compares the repo against its own migrations. Run it while that database
// is up -- verify-database.mjs does exactly that.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const committedPath = resolve(root, 'src/types/database.generated.ts')
const supabase = process.platform === 'win32' ? 'supabase.exe' : 'supabase'

/**
 * Reduce a generated file to just the schema it describes.
 *
 * Line endings and a BOM depend on which shell wrote the file. The
 * __InternalSupabase block matters more: newer CLIs emit it and older ones do
 * not, and it carries the instance's PostgREST version, which legitimately
 * differs between a local container and the hosted project. Comparing it would
 * report a tooling difference as a schema change, which is the opposite of
 * useful.
 */
function normalize(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n')
  const kept = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*\/\/ Allows to automatically instantiate createClient/.test(line)) continue
    if (/^\s*\/\/ instead of createClient</.test(line)) continue

    const opensMetadata = /^(\s*)__InternalSupabase: \{/.exec(line)
    if (opensMetadata) {
      const closing = opensMetadata[1] + '}'
      i += 1
      while (i < lines.length && lines[i] !== closing) i += 1
      continue
    }

    kept.push(line)
  }

  return kept.join('\n').trimEnd()
}

const genTypes = () =>
  spawnSync(supabase, ['gen', 'types', 'typescript', '--local'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })

/**
 * `gen types` runs postgres-meta in a container and, unlike `supabase start`,
 * ignores SUPABASE_INTERNAL_IMAGE_REGISTRY: it always pulls from AWS's public
 * registry. That caps anonymous downloads, and shared CI runners hit the cap
 * ("toomanyrequests: Data limit exceeded"), failing the check with nothing
 * wrong in the schema. Supabase publishes the same images to ghcr.io, so on
 * that error pull the exact image the CLI asked for from there, give it the
 * name the CLI looks for, and let the caller retry. The image name comes from
 * the error rather than being pinned here, so a CLI upgrade needs no edit.
 */
function mirrorRateLimitedImage(stderr) {
  if (!/toomanyrequests/i.test(stderr)) return false
  const match = /Unable to find image '(public\.ecr\.aws\/supabase\/([^']+))' locally/.exec(stderr)
  if (!match) return false
  const [, awsImage, nameAndTag] = match
  const ghcrImage = 'ghcr.io/supabase/' + nameAndTag
  console.log(awsImage + ' is rate-limited; pulling ' + ghcrImage + ' instead.')
  for (const args of [['pull', ghcrImage], ['tag', ghcrImage, awsImage]]) {
    const step = spawnSync('docker', args, { stdio: 'inherit' })
    if (step.status !== 0) return false
  }
  return true
}

let result = genTypes()
if (result.status !== 0 && mirrorRateLimitedImage(result.stderr ?? '')) {
  result = genTypes()
}

if (result.error) {
  console.error('Could not run supabase gen types: ' + result.error.message)
  process.exit(1)
}
if (result.status !== 0) {
  console.error('supabase gen types failed with exit code ' + (result.status ?? 'unknown'))
  if (result.stderr) console.error(result.stderr)
  process.exit(1)
}

const generated = normalize(result.stdout)
const committed = normalize(readFileSync(committedPath, 'utf8'))

if (generated === committed) {
  const definitions = (committed.match(/^ {6}[a-z_]+: \{$/gm) ?? []).length
  console.log(
    'src/types/database.generated.ts matches the migrations (' + definitions + ' definitions)'
  )
  process.exit(0)
}

// Report the first difference rather than dumping a thousand lines.
const committedLines = committed.split('\n')
const generatedLines = generated.split('\n')
const firstDiff = committedLines.findIndex((line, i) => line !== generatedLines[i])

console.error('src/types/database.generated.ts does not match the migrations.')
console.error('')
console.error('Committed: ' + committedLines.length + ' lines')
console.error('Generated: ' + generatedLines.length + ' lines')
if (firstDiff !== -1) {
  console.error('First difference at line ' + (firstDiff + 1) + ':')
  console.error('  committed: ' + JSON.stringify(committedLines[firstDiff] ?? '<end of file>'))
  console.error('  generated: ' + JSON.stringify(generatedLines[firstDiff] ?? '<end of file>'))
}
console.error('')
console.error('A migration changed the schema without the types following it.')
console.error('Regenerate and commit the result:')
console.error('  supabase gen types typescript --local > src/types/database.generated.ts')
process.exit(1)
