import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveScope } from '../src/github.js'

test('resolveScope builds an org-level scope', () => {
  const scope = resolveScope({ org: 'my-org' })
  assert.equal(scope.level, 'org')
  assert.equal(scope.apiBase, '/orgs/my-org/actions/runners')
  assert.equal(scope.registrationUrl, 'https://github.com/my-org')
})

test('resolveScope builds a repo-level scope', () => {
  const scope = resolveScope({ owner: 'octocat', repo: 'hello world' })
  assert.equal(scope.level, 'repo')
  assert.equal(scope.apiBase, '/repos/octocat/hello%20world/actions/runners')
  assert.equal(scope.registrationUrl, 'https://github.com/octocat/hello world')
})

test('resolveScope prefers org over repo when both are given', () => {
  const scope = resolveScope({ org: 'my-org', owner: 'octocat', repo: 'r' })
  assert.equal(scope.level, 'org')
})

test('resolveScope throws when no scope can be determined', () => {
  assert.throws(() => resolveScope({}), /Unable to determine runner scope/)
})
