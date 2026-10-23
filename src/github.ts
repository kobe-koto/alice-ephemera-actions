/**
 * Helpers for GitHub Actions self-hosted runner registration.
 *
 * Registering a new ephemeral runner needs a short-lived registration token;
 * deregistering one needs a removal token. Both come from the REST API and are
 * scoped to either a repository or an organization.
 *
 *   repo: POST /repos/{owner}/{repo}/actions/runners/registration-token
 *   org:  POST /orgs/{org}/actions/runners/registration-token
 */

import { getOctokit } from '@actions/github'

type Octokit = ReturnType<typeof getOctokit>

export type RunnerLevel = 'org' | 'repo'

export interface ScopeOptions {
  /** Organization login for an org-level runner. */
  org?: string
  /** Repository owner (used with `repo`). */
  owner?: string
  /** Repository name (used with `owner`). */
  repo?: string
}

export interface RunnerScope {
  level: RunnerLevel
  apiBase: string
  registrationUrl: string
}

/** Resolve the runner scope (repo vs org) and its API path prefix. */
export function resolveScope ({ org, owner, repo }: ScopeOptions): RunnerScope {
  if (org) {
    return {
      level: 'org',
      apiBase: `/orgs/${encodeURIComponent(org)}/actions/runners`,
      registrationUrl: `https://github.com/${org}`
    }
  }
  if (owner && repo) {
    return {
      level: 'repo',
      apiBase: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}/actions/runners`,
      registrationUrl: `https://github.com/${owner}/${repo}`
    }
  }
  throw new Error(
    'Unable to determine runner scope: provide `organization`, or run inside a repository.'
  )
}

interface Runner {
  id: number
  name: string
  [key: string]: unknown
}

export class GitHubRunners {
  readonly #octokit: Octokit
  readonly #scope: RunnerScope

  constructor (token: string, scopeOpts: ScopeOptions) {
    if (!token) {
      throw new Error(
        'A GitHub token is required to manage self-hosted runners.'
      )
    }
    this.#octokit = getOctokit(token)
    this.#scope = resolveScope(scopeOpts)
  }

  get registrationUrl (): string {
    return this.#scope.registrationUrl
  }

  get level (): RunnerLevel {
    return this.#scope.level
  }

  /** Create a short-lived runner registration token. */
  async createRegistrationToken (): Promise<string> {
    const { data } = await this.#octokit.request(
      `POST ${this.#scope.apiBase}/registration-token`
    )
    return (data as { token: string }).token
  }

  /** Create a short-lived runner removal token. */
  async createRemoveToken (): Promise<string> {
    const { data } = await this.#octokit.request(
      `POST ${this.#scope.apiBase}/remove-token`
    )
    return (data as { token: string }).token
  }

  /** Find a registered runner by its exact name. */
  async findRunnerByName (name: string): Promise<Runner | undefined> {
    const runners = (await this.#octokit.paginate(
      `GET ${this.#scope.apiBase}`,
      { per_page: 100 }
    )) as Runner[]
    return runners.find((r) => r.name === name)
  }

  /** Delete a registered runner by its numeric id. */
  async deleteRunner (runnerId: number): Promise<void> {
    await this.#octokit.request(`DELETE ${this.#scope.apiBase}/{runner_id}`, {
      runner_id: runnerId
    })
  }
}
