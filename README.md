# Alice Ephemera Actions

[English](README.md) | [简体中文](README.zh-CN.md)

Use an [Alice.sh](https://alice.ws/) **Ephemera** (EVO Cloud) instance as an
on-demand, **ephemeral** GitHub Actions self-hosted runner.

The action deploys a fresh Ephemera instance, bootstraps the official GitHub
Actions runner on it in `--ephemeral` mode, waits for it to come online, runs
your jobs, and then destroys the instance — so you only pay for the instance
time you actually use.

API calls follow the official
[Alice Ephemera API documentation](https://web.archive.org/web/20260419053807/https://api.aliceinit.io/).

## How it works

```
┌──────────────┐   start    ┌──────────────────┐   boot script   ┌───────────────┐
│ GitHub-hosted│──────────▶ │  Alice Ephemera   │───────────────▶ │ ephemeral     │
│   runner     │            │  POST .../deploy   │                 │ self-hosted   │
│ (start job)  │            └──────────────────┘                 │ runner online │
└──────────────┘                                                  └───────┬───────┘
       │                                                                  │
       │  your job runs on `runs-on: [self-hosted, alice-ephemera, <id>]` │
       ▼                                                                  ▼
┌──────────────┐   stop     ┌──────────────────┐
│ GitHub-hosted│──────────▶ │  DELETE .../{id}  │  instance destroyed, runner removed
│   runner     │            └──────────────────┘
│ (stop job)   │
└──────────────┘
```

1. A **start** job (on a GitHub-hosted runner) deploys the instance and registers
   the runner. It outputs the `instance-id` and a unique `runner-name`/label.
2. Your **work** job runs `runs-on` that unique label.
3. A **stop** job (with `if: always()`) destroys the instance.

## Prerequisites

- An Alice.sh account with **EVO Cloud / Ephemera** permission, and API
  credentials (**Client ID** and **Secret**).
- A **GitHub token** able to manage self-hosted runners:
  - Repo-level runners: a PAT with the `repo` scope, or a fine-grained token with
    **Administration: read & write** on the repository.
  - Org-level runners: a token with `admin:org` / **Organization self-hosted
    runners: read & write**.

  > The default `GITHUB_TOKEN` **cannot** manage runners — you must supply your own.

Store these as repository/organization secrets, e.g. `ALICE_CLIENT_ID`,
`ALICE_SECRET`, and `GH_RUNNER_TOKEN`.

## Usage

```yaml
name: ci
on: [push]

jobs:
  start-runner:
    runs-on: ubuntu-latest
    outputs:
      instance-id: ${{ steps.start.outputs.instance-id }}
      runner-name: ${{ steps.start.outputs.runner-name }}
    steps:
      - id: start
        uses: your-org/alice-ephemera-actions@v1
        with:
          mode: start
          alice-client-id: ${{ secrets.ALICE_CLIENT_ID }}
          alice-secret: ${{ secrets.ALICE_SECRET }}
          github-token: ${{ secrets.GH_RUNNER_TOKEN }}
          plan: 'EVO-2C2G'          # or: plan-id: 123
          os: 'Ubuntu 22.04'        # or: os-id: 456
          time: 1                   # instance lifetime in hours
          labels: 'self-hosted,alice-ephemera,${{ github.run_id }}'

  do-the-work:
    needs: start-runner
    runs-on:
      - self-hosted
      - alice-ephemera
      - ${{ github.run_id }}
    steps:
      - uses: actions/checkout@v7
      - run: |
          echo "Running on an Alice Ephemera instance!"
          uname -a

  stop-runner:
    needs: [start-runner, do-the-work]
    runs-on: ubuntu-latest
    if: always()                    # always tear down, even on failure
    steps:
      - uses: your-org/alice-ephemera-actions@v1
        with:
          mode: stop
          alice-client-id: ${{ secrets.ALICE_CLIENT_ID }}
          alice-secret: ${{ secrets.ALICE_SECRET }}
          github-token: ${{ secrets.GH_RUNNER_TOKEN }}
          instance-id: ${{ needs.start-runner.outputs.instance-id }}
          runner-name: ${{ needs.start-runner.outputs.runner-name }}
```

Using `${{ github.run_id }}` as a label guarantees the work job lands on the
instance this workflow just created, rather than any other self-hosted runner.

## Inputs

### Common

| Input | Required | Description |
| --- | --- | --- |
| `mode` | yes | `start` to deploy a runner, `stop` to destroy it. |
| `alice-client-id` | yes | Alice.sh API Client ID. |
| `alice-secret` | yes | Alice.sh API Secret. |
| `github-token` | yes | Token with permission to manage self-hosted runners. |
| `organization` | no | Org login for an org-level runner. Omit for a repo-level runner. |

### `mode: start`

| Input | Default | Description |
| --- | --- | --- |
| `plan-id` / `plan` | — | Plan id, or plan name resolved via the API. One is required. |
| `os-id` / `os` | — | OS image id, or OS name resolved via the API. One is required. |
| `time` | `1` | Instance lifetime in hours. |
| `ssh-key-id` | — | Optional Alice SSH key id to inject. |
| `runner-version` | `2.321.0` | GitHub Actions runner release to install. |
| `arch` | `x64` | Runner architecture: `x64`, `arm64`, or `arm`. |
| `labels` | `self-hosted,alice-ephemera` | Comma-separated runner labels. |
| `runner-group` | `Default` | Runner group (org-level runners). |
| `pre-runner-script` | — | Shell commands run on the instance before the runner is configured. |
| `wait-timeout` | `600` | Seconds to wait for the instance and runner to come online. |

### `mode: stop`

| Input | Required | Description |
| --- | --- | --- |
| `instance-id` | yes | Alice instance id to destroy. |
| `runner-name` | no | Runner name to deregister (ephemeral runners also self-remove). |

## Outputs (`mode: start`)

| Output | Description |
| --- | --- |
| `instance-id` | Id of the deployed Alice instance. |
| `runner-name` | Name of the registered runner. |
| `instance-ipv4` | IPv4 address of the instance, if assigned. |
| `instance-ipv6` | IPv6 address of the instance, if assigned. |

## Notes & limitations

- **Boot script.** The runner is installed via the Alice `boot_script` (base64,
  run once at first boot). The instance OS must be a Linux image with `apt`,
  `dnf`, or `yum`, and outbound access to `github.com`.
- **Ephemeral.** The runner uses `--ephemeral`, so it unregisters itself after a
  single job. The `stop` job still destroys the instance and removes any
  leftover registration.
- **Always stop.** Give the stop job `if: always()` so a failed or cancelled
  work job never leaves a billed instance running.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test (unit tests)
npm run build       # bundle to dist/ with @vercel/ncc
```

`dist/` is committed so the action can run directly from the repository. Rebuild
and commit it whenever you change anything under `src/`.

## License

GPL-3.0
