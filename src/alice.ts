/**
 * Minimal, typed client for the Alice.sh Ephemera (EVO Cloud) CLI API.
 *
 * API reference: https://github.com/Montia37/AliceEphemera
 * Base URL: https://app.alice.ws/cli/v1
 * Auth:     Authorization: Bearer <clientId>:<secret>
 */

export const API_URL = 'https://app.alice.ws/cli/v1'

/** The Alice API wraps every payload as `{ status, message, data }`. */
interface ApiEnvelope<T> {
  status?: number
  message?: string
  error?: string
  msg?: string
  data?: T
}

export interface EvoPermissions {
  /** `|`-separated list of plan ids the account may deploy. */
  allow_packages?: string
  /** Maximum lifetime, in hours. */
  max_time?: number
  [key: string]: unknown
}

export interface Plan {
  id: number
  name: string
  cpu: number
  memory: number
  disk: number
  /** `|`-separated list of OS image ids, present on some responses. */
  os?: string
  [key: string]: unknown
}

export interface OsImage {
  id: number
  name: string
  [key: string]: unknown
}

export interface OsImageGroup {
  os_list?: OsImage[]
  [key: string]: unknown
}

export interface SshKey {
  id: number
  name: string
  created_at?: string
  [key: string]: unknown
}

export interface Instance {
  id: number
  plan?: string
  os?: string
  ipv4?: string
  ipv6?: string
  hostname?: string
  cpu?: number
  memory?: number
  disk?: number
  creation_at?: string
  expiration_at?: string
  /** Present when a boot script was supplied at deploy time. */
  boot_script_uid?: string
  [key: string]: unknown
}

export interface InstanceState {
  /** Fetch status of the state call itself, e.g. "complete". */
  status: string
  message?: string | null
  state: {
    /** Power state of the instance, e.g. "running" | "stopped". */
    state: string
    cpu: number
    memory: {
      memtotal: number
      memfree: number
      memavailable: number
    }
    traffic: {
      in: number
      out: number
      total: number
    }
  }
}

export interface DeployParams {
  productId: number
  osId: number
  /** Lifetime in hours. */
  time: number
  sshKeyId?: number
  /** Base64-encoded boot script. */
  bootScript?: string
}

export class AliceApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor (message: string, status: number, body: unknown) {
    super(message)
    this.name = 'AliceApiError'
    this.status = status
    this.body = body
  }
}

export interface AliceClientOptions {
  /** Override the base URL (mainly for testing). */
  baseUrl?: string
  /** Per-request timeout in milliseconds. */
  timeout?: number
}

export class AliceClient {
  readonly #token: string
  readonly #baseUrl: string
  readonly #timeout: number

  constructor (clientId: string, secret: string, opts: AliceClientOptions = {}) {
    if (!clientId || !secret) {
      throw new Error('Alice API requires both a Client ID and a Secret.')
    }
    this.#token = `${clientId}:${secret}`
    this.#baseUrl = (opts.baseUrl ?? API_URL).replace(/\/+$/, '')
    this.#timeout = opts.timeout ?? 30_000
  }

  /**
   * Perform an authenticated request and return the unwrapped `data` field.
   */
  async #request<T> (
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#timeout)

    let res: Response
    try {
      res = await fetch(`${this.#baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          Accept: 'application/json',
          ...(body !== undefined
            ? { 'Content-Type': 'application/json;charset=utf-8' }
            : {})
        },
        body: body !== undefined ? JSON.stringify(body) : null
      })
    } catch (err) {
      const e = err as Error
      if (e.name === 'AbortError') {
        throw new AliceApiError(
          `Request timed out after ${this.#timeout}ms: ${method} ${path}`,
          0,
          null
        )
      }
      throw new AliceApiError(
        `Network error calling ${method} ${path}: ${e.message}`,
        0,
        null
      )
    } finally {
      clearTimeout(timer)
    }

    const text = await res.text()
    let json: ApiEnvelope<T> & { raw?: string }
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      json = { raw: text }
    }

    if (!res.ok) {
      const detail = json.message ?? json.error ?? json.msg ?? res.statusText
      throw new AliceApiError(
        `Alice API ${method} ${path} failed (${res.status}): ${detail}`,
        res.status,
        json
      )
    }

    return (
      Object.prototype.hasOwnProperty.call(json, 'data')
        ? json.data
        : (json as unknown)
    ) as T
  }

  /** List the account's current EVO instances. */
  listInstances (): Promise<Instance[]> {
    return this.#request<Instance[]>('GET', '/evo/instances')
  }

  /** Get EVO permissions (allowed packages, max_time, …). */
  getPermissions (): Promise<EvoPermissions> {
    return this.#request<EvoPermissions>('GET', '/evo/permissions')
  }

  /** List available plans (products). */
  listPlans (): Promise<Plan[]> {
    return this.#request<Plan[]>('GET', '/evo/plans')
  }

  /** List OS images available for a plan. */
  listOsImages (planId: number): Promise<OsImageGroup[]> {
    return this.#request<OsImageGroup[]>('GET', `/evo/plans/${planId}/os-images`)
  }

  /** List the account's SSH keys. */
  listSshKeys (): Promise<SshKey[]> {
    return this.#request<SshKey[]>('GET', '/account/ssh-keys')
  }

  /** Get live state for an instance. */
  getInstanceState (instanceId: number): Promise<InstanceState> {
    return this.#request<InstanceState>(
      'GET',
      `/evo/instances/${instanceId}/state`
    )
  }

  /** Deploy (create) a new instance; resolves to the created instance. */
  deployInstance (params: DeployParams): Promise<Instance> {
    const payload: Record<string, unknown> = {
      product_id: params.productId,
      os_id: params.osId,
      time: params.time
    }
    if (params.sshKeyId) payload.ssh_key_id = params.sshKeyId
    if (params.bootScript) payload.boot_script = params.bootScript
    return this.#request<Instance>('POST', '/evo/instances/deploy', payload)
  }

  /** Delete (destroy) an instance. */
  deleteInstance (instanceId: number): Promise<unknown> {
    return this.#request('DELETE', `/evo/instances/${instanceId}`)
  }

  /** Control instance power. */
  powerInstance (
    instanceId: number,
    action: 'boot' | 'shutdown' | 'restart' | 'poweroff'
  ): Promise<unknown> {
    return this.#request('POST', `/evo/instances/${instanceId}/power`, {
      action
    })
  }

  /** Extend an instance's lifetime by `time` hours. */
  renewInstance (instanceId: number, time: number): Promise<unknown> {
    return this.#request('POST', `/evo/instances/${instanceId}/renewals`, {
      time
    })
  }

  /** Fetch the result of a boot-script / exec command. */
  getCommandResult (
    instanceId: number,
    commandUid: string
  ): Promise<unknown> {
    return this.#request(
      'GET',
      `/evo/instances/${instanceId}/exec/${commandUid}`
    )
  }
}
