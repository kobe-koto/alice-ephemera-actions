import * as core from '@actions/core'

export type Mode = 'start' | 'stop'

export interface StartInputs {
  mode: 'start'
  aliceClientId: string
  aliceSecret: string
  githubToken: string
  organization?: string
  /** Plan id, or plan name to resolve via the API. */
  planId?: number
  planName?: string
  /** OS image id, or OS name to resolve via the API. */
  osId?: number
  osName?: string
  /** Instance lifetime in hours. */
  time: number
  sshKeyId?: number
  runnerVersion: string
  arch: 'x64' | 'arm64' | 'arm'
  labels: string[]
  runnerGroup?: string
  preRunnerScript?: string
  /** How long to wait (seconds) for the runner to come online. */
  waitTimeout: number
}

export interface StopInputs {
  mode: 'stop'
  aliceClientId: string
  aliceSecret: string
  githubToken: string
  organization?: string
  instanceId: number
  runnerName?: string
}

export type Inputs = StartInputs | StopInputs

function required (name: string): string {
  const value = core.getInput(name, { required: true }).trim()
  if (!value) throw new Error(`Input "${name}" is required.`)
  return value
}

function optional (name: string): string | undefined {
  const value = core.getInput(name).trim()
  return value === '' ? undefined : value
}

function optionalNumber (name: string): number | undefined {
  const raw = optional(name)
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new Error(`Input "${name}" must be a number.`)
  return n
}

export function parseInputs (): Inputs {
  const mode = required('mode').toLowerCase()
  if (mode !== 'start' && mode !== 'stop') {
    throw new Error(`Input "mode" must be "start" or "stop" (got "${mode}").`)
  }

  const common = {
    aliceClientId: required('alice-client-id'),
    aliceSecret: required('alice-secret'),
    githubToken: required('github-token'),
    ...optionalProp('organization', optional('organization'))
  }

  if (mode === 'stop') {
    const instanceId = optionalNumber('instance-id')
    if (instanceId === undefined) {
      throw new Error('Input "instance-id" is required when mode is "stop".')
    }
    return {
      mode: 'stop',
      ...common,
      instanceId,
      ...optionalProp('runnerName', optional('runner-name'))
    }
  }

  const labels = (optional('labels') ?? '')
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean)

  const arch = (optional('arch') ?? 'x64') as StartInputs['arch']
  if (!['x64', 'arm64', 'arm'].includes(arch)) {
    throw new Error(`Input "arch" must be one of x64, arm64, arm (got "${arch}").`)
  }

  return {
    mode: 'start',
    ...common,
    ...optionalProp('planId', optionalNumber('plan-id')),
    ...optionalProp('planName', optional('plan')),
    ...optionalProp('osId', optionalNumber('os-id')),
    ...optionalProp('osName', optional('os')),
    time: optionalNumber('time') ?? 1,
    ...optionalProp('sshKeyId', optionalNumber('ssh-key-id')),
    runnerVersion: optional('runner-version') ?? '2.321.0',
    arch,
    labels,
    ...optionalProp('runnerGroup', optional('runner-group')),
    ...optionalProp('preRunnerScript', optional('pre-runner-script')),
    waitTimeout: optionalNumber('wait-timeout') ?? 600
  }
}

/** Build `{ key: value }` only when value is defined, for exactOptionalPropertyTypes. */
function optionalProp<K extends string, V> (
  key: K,
  value: V | undefined
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}
