import * as core from '@actions/core'
import { context } from '@actions/github'
import { randomBytes } from 'node:crypto'

import {
  AliceClient,
  type Instance,
  type OsImage,
  type Plan
} from './alice.js'
import { GitHubRunners } from './github.js'
import { buildEncodedBootScript } from './bootScript.js'
import {
  parseInputs,
  type StartInputs,
  type StopInputs
} from './inputs.js'

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** Resolve the plan id from an explicit id or a plan name. */
async function resolvePlanId (
  alice: AliceClient,
  inputs: StartInputs
): Promise<number> {
  if (inputs.planId !== undefined) return inputs.planId
  if (!inputs.planName) {
    throw new Error('Provide either `plan-id` or `plan` to select a plan.')
  }
  const plans = await alice.listPlans()
  const match = plans.find(
    (p: Plan) => p.name.toLowerCase() === inputs.planName!.toLowerCase()
  )
  if (!match) {
    const names = plans.map((p) => p.name).join(', ')
    throw new Error(
      `Plan "${inputs.planName}" not found. Available plans: ${names || '(none)'}`
    )
  }
  return match.id
}

/** Resolve the OS image id from an explicit id or an OS name, for a plan. */
async function resolveOsId (
  alice: AliceClient,
  planId: number,
  inputs: StartInputs
): Promise<number> {
  if (inputs.osId !== undefined) return inputs.osId
  if (!inputs.osName) {
    throw new Error('Provide either `os-id` or `os` to select an OS image.')
  }
  const groups = await alice.listOsImages(planId)
  const images: OsImage[] = groups.flatMap((g) => g.os_list ?? [])
  const match = images.find(
    (o) => o.name.toLowerCase() === inputs.osName!.toLowerCase()
  )
  if (!match) {
    const names = images.map((o) => o.name).join(', ')
    throw new Error(
      `OS image "${inputs.osName}" not found for plan ${planId}. ` +
        `Available images: ${names || '(none)'}`
    )
  }
  return match.id
}

/** Poll Alice until the instance reports a running state (or time out). */
async function waitForInstanceRunning (
  alice: AliceClient,
  instanceId: number,
  timeoutSec: number
): Promise<void> {
  const deadline = Date.now() + timeoutSec * 1000
  let lastState = 'unknown'
  while (Date.now() < deadline) {
    try {
      const info = await alice.getInstanceState(instanceId)
      lastState = info.state?.state ?? info.status ?? 'unknown'
      if (lastState === 'running') {
        core.info(`Instance ${instanceId} is running.`)
        return
      }
      core.info(`Waiting for instance ${instanceId} (state: ${lastState})…`)
    } catch (err) {
      core.info(`State check failed, retrying: ${(err as Error).message}`)
    }
    await sleep(5000)
  }
  throw new Error(
    `Timed out after ${timeoutSec}s waiting for instance ${instanceId} ` +
      `to run (last state: ${lastState}).`
  )
}

/** Poll GitHub until the named runner is registered and online. */
async function waitForRunnerOnline (
  runners: GitHubRunners,
  runnerName: string,
  timeoutSec: number
): Promise<void> {
  const deadline = Date.now() + timeoutSec * 1000
  while (Date.now() < deadline) {
    const runner = await runners.findRunnerByName(runnerName)
    if (runner && (runner as { status?: string }).status === 'online') {
      core.info(`Runner "${runnerName}" is online.`)
      return
    }
    core.info(`Waiting for runner "${runnerName}" to come online…`)
    await sleep(10_000)
  }
  throw new Error(
    `Timed out after ${timeoutSec}s waiting for runner "${runnerName}" ` +
      'to register. Check the instance boot logs on the Alice console.'
  )
}

async function start (inputs: StartInputs): Promise<void> {
  const alice = new AliceClient(inputs.aliceClientId, inputs.aliceSecret)
  const runners = new GitHubRunners(inputs.githubToken, {
    ...(inputs.organization ? { org: inputs.organization } : {}),
    owner: context.repo.owner,
    repo: context.repo.repo
  })

  const planId = await resolvePlanId(alice, inputs)
  const osId = await resolveOsId(alice, planId, inputs)

  const runnerName = `alice-${randomBytes(6).toString('hex')}`
  const labels =
    inputs.labels.length > 0
      ? [...new Set([...inputs.labels])]
      : ['self-hosted', 'alice-ephemera']

  core.info(
    `Requesting runner registration token for ${runners.registrationUrl} ` +
      `(${runners.level}-level)…`
  )
  const registrationToken = await runners.createRegistrationToken()

  const bootScript = buildEncodedBootScript({
    registrationUrl: runners.registrationUrl,
    registrationToken,
    runnerName,
    labels: labels.join(','),
    runnerVersion: inputs.runnerVersion,
    arch: inputs.arch,
    ...(inputs.runnerGroup ? { runnerGroup: inputs.runnerGroup } : {}),
    ...(inputs.preRunnerScript
      ? { preRunnerScript: inputs.preRunnerScript }
      : {})
  })

  core.info(`Deploying Alice Ephemera instance (plan ${planId}, os ${osId})…`)
  let instance: Instance
  try {
    instance = await alice.deployInstance({
      productId: planId,
      osId,
      time: inputs.time,
      ...(inputs.sshKeyId ? { sshKeyId: inputs.sshKeyId } : {}),
      bootScript
    })
  } catch (err) {
    throw new Error(`Failed to deploy Alice instance: ${(err as Error).message}`)
  }

  core.info(`Deployed instance ${instance.id} (${instance.ipv4 ?? 'no ipv4'}).`)
  core.setOutput('instance-id', instance.id)
  core.setOutput('runner-name', runnerName)
  if (instance.ipv4) core.setOutput('instance-ipv4', instance.ipv4)
  if (instance.ipv6) core.setOutput('instance-ipv6', instance.ipv6)
  // Persist for a later stop job and for `post` cleanup.
  core.saveState('instance-id', String(instance.id))
  core.saveState('runner-name', runnerName)

  try {
    await waitForInstanceRunning(alice, instance.id, inputs.waitTimeout)
    await waitForRunnerOnline(runners, runnerName, inputs.waitTimeout)
  } catch (err) {
    core.warning(
      `Runner did not come online; destroying instance ${instance.id}.`
    )
    await alice.deleteInstance(instance.id).catch(() => {})
    throw err
  }

  core.info('Runner is ready to accept jobs.')
}

async function stop (inputs: StopInputs): Promise<void> {
  const alice = new AliceClient(inputs.aliceClientId, inputs.aliceSecret)
  const runners = new GitHubRunners(inputs.githubToken, {
    ...(inputs.organization ? { org: inputs.organization } : {}),
    owner: context.repo.owner,
    repo: context.repo.repo
  })

  // Best-effort: remove the runner registration first.
  if (inputs.runnerName) {
    try {
      const runner = await runners.findRunnerByName(inputs.runnerName)
      if (runner) {
        core.info(`Deregistering runner "${inputs.runnerName}" (#${runner.id})…`)
        await runners.deleteRunner(runner.id)
      } else {
        core.info(
          `Runner "${inputs.runnerName}" not found (already removed). ` +
            'Ephemeral runners deregister themselves after a job.'
        )
      }
    } catch (err) {
      core.warning(`Failed to deregister runner: ${(err as Error).message}`)
    }
  }

  core.info(`Destroying Alice instance ${inputs.instanceId}…`)
  try {
    await alice.deleteInstance(inputs.instanceId)
    core.info(`Instance ${inputs.instanceId} destroyed.`)
  } catch (err) {
    throw new Error(
      `Failed to destroy instance ${inputs.instanceId}: ${(err as Error).message}`
    )
  }
}

async function run (): Promise<void> {
  const inputs = parseInputs()
  core.setSecret(inputs.aliceSecret)
  if (inputs.mode === 'start') {
    await start(inputs)
  } else {
    await stop(inputs)
  }
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err))
})
