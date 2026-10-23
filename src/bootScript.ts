/**
 * Builds the boot script that turns a fresh Alice Ephemera instance into an
 * ephemeral GitHub Actions self-hosted runner.
 *
 * The script is run once by the Alice platform at first boot. It downloads the
 * official runner, configures it with a one-time registration token in
 * `--ephemeral` mode (so the runner deregisters itself after a single job),
 * installs it as a service and starts it.
 */

export interface BootScriptParams {
  /** e.g. https://github.com/owner/repo or https://github.com/org */
  registrationUrl: string
  /** Short-lived runner registration token. */
  registrationToken: string
  /** Unique runner name. */
  runnerName: string
  /** Comma-separated labels applied to the runner. */
  labels: string
  /** Runner group (org-level runners); defaults to "Default". */
  runnerGroup?: string
  /** GitHub Actions runner release to install, e.g. "2.321.0". */
  runnerVersion: string
  /** Target architecture for the runner package. */
  arch?: 'x64' | 'arm64' | 'arm'
  /** Extra shell commands run before the runner is configured. */
  preRunnerScript?: string
}

const ARCH_MAP: Record<string, string> = {
  x64: 'x64',
  arm64: 'arm64',
  arm: 'arm'
}

/** Escape a value for safe embedding inside single quotes in bash. */
function shSingleQuote (value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Produce the raw (unencoded) boot script.
 */
export function buildBootScript (params: BootScriptParams): string {
  const arch = ARCH_MAP[params.arch ?? 'x64'] ?? 'x64'
  const group = params.runnerGroup ?? 'Default'
  const version = params.runnerVersion.replace(/^v/, '')

  // The runner cannot be configured or run as root, so we provision a
  // dedicated unprivileged user and run everything as that user.
  return `#!/usr/bin/env bash
# Provisioned by alice-ephemera-actions — ephemeral GitHub Actions runner.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
RUNNER_VERSION=${shSingleQuote(version)}
RUNNER_ARCH=${shSingleQuote(arch)}
RUNNER_NAME=${shSingleQuote(params.runnerName)}
RUNNER_LABELS=${shSingleQuote(params.labels)}
RUNNER_GROUP=${shSingleQuote(group)}
RUNNER_URL=${shSingleQuote(params.registrationUrl)}
RUNNER_TOKEN=${shSingleQuote(params.registrationToken)}
RUNNER_USER=github-runner
RUNNER_HOME=/opt/actions-runner

log() { echo "[alice-runner] $*"; }

log "Installing prerequisites"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends curl ca-certificates tar jq sudo
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y curl ca-certificates tar jq sudo
elif command -v yum >/dev/null 2>&1; then
  yum install -y curl ca-certificates tar jq sudo
fi

log "Creating runner user"
id -u "$RUNNER_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$RUNNER_USER"
mkdir -p "$RUNNER_HOME"
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_HOME"

log "Downloading GitHub Actions runner v$RUNNER_VERSION ($RUNNER_ARCH)"
cd "$RUNNER_HOME"
TARBALL="actions-runner-linux-$RUNNER_ARCH-$RUNNER_VERSION.tar.gz"
curl -fsSL -o "$TARBALL" \\
  "https://github.com/actions/runner/releases/download/v$RUNNER_VERSION/$TARBALL"
tar xzf "$TARBALL"
rm -f "$TARBALL"
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_HOME"

# Allow the runner's bundled dependency installer to use sudo non-interactively.
if [ -x ./bin/installdependencies.sh ]; then
  log "Installing runner dependencies"
  ./bin/installdependencies.sh || true
fi
${
  params.preRunnerScript
    ? `
log "Running pre-runner script"
${params.preRunnerScript}
`
    : ''
}
log "Configuring ephemeral runner $RUNNER_NAME"
sudo -u "$RUNNER_USER" ./config.sh \\
  --unattended \\
  --ephemeral \\
  --url "$RUNNER_URL" \\
  --token "$RUNNER_TOKEN" \\
  --name "$RUNNER_NAME" \\
  --labels "$RUNNER_LABELS" \\
  --runnergroup "$RUNNER_GROUP" \\
  --replace

log "Installing and starting runner service"
./svc.sh install "$RUNNER_USER"
./svc.sh start

log "Runner $RUNNER_NAME is online"
`
}

/** Build the boot script and return it base64-encoded, as Alice expects. */
export function buildEncodedBootScript (params: BootScriptParams): string {
  return Buffer.from(buildBootScript(params), 'utf-8').toString('base64')
}
