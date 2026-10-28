#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

if (!process.argv.includes('--allow-reset')) {
  console.error('Refusing to reset the local database without --allow-reset.')
  console.error('Run: npm run verify:db -- --allow-reset')
  process.exit(2)
}

const root = resolve(import.meta.dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const supabase = process.platform === 'win32' ? 'supabase.exe' : 'supabase'
let stackStarted = false

function run(label, command, args, options = {}) {
  console.log(`\n=== ${label} ===`)
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  })
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`)
  return result.stdout ?? ''
}

const sleepSeconds = (seconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000)

/**
 * Starting the stack pulls about a gigabyte of images from ghcr.io, which
 * throttles shared CI runners per minute ("toomanyrequests ... allowed:
 * 44000/minute"). The CLI's own retries give up within seconds, so a busy
 * minute failed the whole check with nothing wrong in the repo. Wait out the
 * window and try again, but only for that error: anything else fails at once.
 */
function startStack(args) {
  const waits = [60, 120]
  for (let attempt = 0; ; attempt += 1) {
    console.log(`\n=== Start disposable Supabase${attempt ? ` (retry ${attempt})` : ''} ===`)
    const result = spawnSync(supabase, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    if (result.error) throw new Error(`Start disposable Supabase could not start: ${result.error.message}`)
    if (result.status === 0) return
    const rateLimited = /toomanyrequests/i.test(`${result.stdout}\n${result.stderr}`)
    if (!rateLimited || attempt >= waits.length) {
      throw new Error(`Start disposable Supabase failed with exit code ${result.status ?? 'unknown'}`)
    }
    console.log(`Image registry rate limit hit; waiting ${waits[attempt]}s before retrying.`)
    spawnSync(supabase, ['stop', '--no-backup'], { cwd: root, stdio: 'inherit' })
    sleepSeconds(waits[attempt])
  }
}

function parseEnv(output) {
  const values = {}
  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/.exec(line.trim())
    if (match) values[match[1]] = match[2] ?? match[3] ?? ''
  }
  return values
}

try {
  startStack(['start', '-x', 'studio,imgproxy,inbucket,edge-runtime,analytics,vector,functions,realtime'])
  stackStarted = true
  run('Rebuild database from migrations', supabase, ['db', 'reset', '--local'])
  run('Database lint', supabase, ['db', 'lint', '--local', '--level', 'error'])
  // Runs here, not in verify-release, because it needs the disposable database
  // this script has just built from the migrations.
  run('Generated types match migrations', npm, ['run', 'check:db-types'])

  const local = parseEnv(run('Read local test configuration', supabase, ['status', '-o', 'env'], { capture: true }))
  for (const name of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY']) {
    if (!local[name]) throw new Error(`Supabase status did not return ${name}`)
  }

  run('Tenant, RBAC, storage, and import integration tests', npm, ['run', 'test:tenant'], {
    env: {
      ALLOW_REMOTE_SUPABASE_TESTS: 'true',
      SUPABASE_TEST_URL: local.API_URL,
      SUPABASE_TEST_ANON_KEY: local.ANON_KEY,
      SUPABASE_TEST_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
    },
  })
  console.log('\nDisposable database verification passed.')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (stackStarted) {
    const stopped = spawnSync(supabase, ['stop', '--no-backup'], { cwd: root, stdio: 'inherit' })
    if (stopped.status !== 0) process.exitCode = 1
  }
}
