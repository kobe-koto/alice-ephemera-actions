import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildBootScript, buildEncodedBootScript } from '../src/bootScript.js'

const base = {
  registrationUrl: 'https://github.com/owner/repo',
  registrationToken: 'AAAA',
  runnerName: 'alice-abc123',
  labels: 'self-hosted,alice-ephemera',
  runnerVersion: '2.321.0'
}

test('boot script embeds runner config in ephemeral mode', () => {
  const script = buildBootScript(base)
  assert.match(script, /#!\/usr\/bin\/env bash/)
  assert.match(script, /--ephemeral/)
  assert.match(script, /RUNNER_VERSION='2\.321\.0'/)
  assert.match(script, /RUNNER_NAME='alice-abc123'/)
  assert.match(script, /RUNNER_URL='https:\/\/github\.com\/owner\/repo'/)
  assert.match(script, /RUNNER_ARCH='x64'/)
})

test('boot script strips a leading v from the version', () => {
  const script = buildBootScript({ ...base, runnerVersion: 'v2.330.0' })
  assert.match(script, /RUNNER_VERSION='2\.330\.0'/)
})

test('boot script honours arch and runner group', () => {
  const script = buildBootScript({
    ...base,
    arch: 'arm64',
    runnerGroup: 'linux-runners'
  })
  assert.match(script, /RUNNER_ARCH='arm64'/)
  assert.match(script, /RUNNER_GROUP='linux-runners'/)
})

test('boot script includes the pre-runner script when provided', () => {
  const script = buildBootScript({
    ...base,
    preRunnerScript: 'apt-get install -y docker.io'
  })
  assert.match(script, /Running pre-runner script/)
  assert.match(script, /apt-get install -y docker\.io/)
})

test('boot script omits the pre-runner section when absent', () => {
  const script = buildBootScript(base)
  assert.doesNotMatch(script, /Running pre-runner script/)
})

test('single quotes in values are escaped safely', () => {
  const script = buildBootScript({ ...base, runnerName: "a'b" })
  assert.match(script, /RUNNER_NAME='a'\\''b'/)
})

test('encoded boot script round-trips through base64', () => {
  const encoded = buildEncodedBootScript(base)
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8')
  assert.equal(decoded, buildBootScript(base))
})
