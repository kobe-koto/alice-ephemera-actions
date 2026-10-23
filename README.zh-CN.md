# Alice Ephemera Actions

[English](README.md) | [简体中文](README.zh-CN.md)

将 [Alice.sh](https://alice.ws/) 的 **Ephemera**（EVO Cloud）实例用作按需、
**一次性（ephemeral）**的 GitHub Actions 自托管 Runner。

该 Action 会部署一个全新的 Ephemera 实例，在其上以 `--ephemeral` 模式引导启动
官方的 GitHub Actions Runner，等待其上线，运行你的作业，随后销毁该实例——这样
你只需为实际使用的实例时长付费。

API 调用遵循官方的
[Alice Ephemera API 文档](https://web.archive.org/web/20260419053807/https://api.aliceinit.io/)。

## 工作原理

```
┌──────────────┐   start    ┌──────────────────┐   boot script   ┌───────────────┐
│ GitHub 托管   │──────────▶ │  Alice Ephemera   │───────────────▶ │ 一次性        │
│   Runner     │            │  POST .../deploy   │                 │ 自托管 Runner │
│ (start 作业)  │            └──────────────────┘                 │ 上线          │
└──────────────┘                                                  └───────┬───────┘
       │                                                                  │
       │  你的作业跑在 `runs-on: [self-hosted, alice-ephemera, <id>]` 上     │
       ▼                                                                  ▼
┌──────────────┐   stop     ┌──────────────────┐
│ GitHub 托管   │──────────▶ │  DELETE .../{id}  │  实例销毁，Runner 注销
│   Runner     │            └──────────────────┘
│ (stop 作业)   │
└──────────────┘
```

1. **start** 作业（运行在 GitHub 托管的 Runner 上）部署实例并注册 Runner。它会输出
   `instance-id` 以及唯一的 `runner-name` / 标签（label）。
2. 你的 **work** 作业通过 `runs-on` 指定那个唯一标签。
3. **stop** 作业（配合 `if: always()`）销毁实例。

## 前置条件

- 一个拥有 **EVO Cloud / Ephemera** 权限的 Alice.sh 账户，以及 API 凭据
  （**Client ID** 和 **Secret**）。
- 一个能够管理自托管 Runner 的 **GitHub token**：
  - 仓库级 Runner：具有 `repo` scope 的 PAT，或对该仓库具有
    **Administration: read & write** 权限的细粒度 token。
  - 组织级 Runner：具有 `admin:org` / **Organization self-hosted runners:
    read & write** 权限的 token。

  > 默认的 `GITHUB_TOKEN` **无法**管理 Runner——你必须自行提供 token。

将这些凭据存为仓库/组织的 Secret，例如 `ALICE_CLIENT_ID`、`ALICE_SECRET`
和 `GH_RUNNER_TOKEN`。

## 使用方法

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
          plan: 'EVO-2C2G'          # 或：plan-id: 123
          os: 'Ubuntu 22.04'        # 或：os-id: 456
          time: 1                   # 实例时长（小时）
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
    if: always()                    # 始终拆除，即使作业失败
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

用 `${{ github.run_id }}` 作为标签，可以确保 work 作业落在本次工作流刚刚创建的
实例上，而不是任何其他自托管 Runner。

## 输入（Inputs）

### 通用

| 输入 | 必填 | 说明 |
| --- | --- | --- |
| `mode` | 是 | `start` 部署 Runner，`stop` 销毁 Runner。 |
| `alice-client-id` | 是 | Alice.sh API Client ID。 |
| `alice-secret` | 是 | Alice.sh API Secret。 |
| `github-token` | 是 | 具有管理自托管 Runner 权限的 token。 |
| `organization` | 否 | 组织登录名，用于创建组织级 Runner。省略则创建仓库级 Runner。 |

### `mode: start`

| 输入 | 默认值 | 说明 |
| --- | --- | --- |
| `plan-id` / `plan` | — | 计划 id，或通过 API 解析的计划名称。二者必填其一。 |
| `os-id` / `os` | — | 操作系统镜像 id，或通过 API 解析的镜像名称。二者必填其一。 |
| `time` | `1` | 实例时长（小时）。 |
| `ssh-key-id` | — | 可选，要注入的 Alice SSH 密钥 id。 |
| `runner-version` | `2.321.0` | 要安装的 GitHub Actions Runner 版本。 |
| `arch` | `x64` | Runner 架构：`x64`、`arm64` 或 `arm`。 |
| `labels` | `self-hosted,alice-ephemera` | 逗号分隔的 Runner 标签。 |
| `runner-group` | `Default` | Runner 组（组织级 Runner）。 |
| `pre-runner-script` | — | 在配置 Runner 之前，在实例上执行的 shell 命令。 |
| `wait-timeout` | `600` | 等待实例与 Runner 上线的秒数。 |

### `mode: stop`

| 输入 | 必填 | 说明 |
| --- | --- | --- |
| `instance-id` | 是 | 要销毁的 Alice 实例 id。 |
| `runner-name` | 否 | 要注销的 Runner 名称（一次性 Runner 也会自行注销）。 |

## 输出（Outputs，`mode: start`）

| 输出 | 说明 |
| --- | --- |
| `instance-id` | 已部署 Alice 实例的 id。 |
| `runner-name` | 已注册 Runner 的名称。 |
| `instance-ipv4` | 实例的 IPv4 地址（若已分配）。 |
| `instance-ipv6` | 实例的 IPv6 地址（若已分配）。 |

## 注意事项与限制

- **启动脚本（boot script）。** Runner 通过 Alice 的 `boot_script`（Base64，
  在首次开机时运行一次）安装。实例操作系统必须是带有 `apt`、`dnf` 或 `yum` 的
  Linux 镜像，并能访问 `github.com`。
- **一次性（Ephemeral）。** Runner 使用 `--ephemeral`，因此在运行单个作业后会
  自行注销。stop 作业仍会销毁实例并清理任何残留的注册信息。
- **始终执行 stop。** 为 stop 作业设置 `if: always()`，确保失败或被取消的 work
  作业不会遗留仍在计费的实例。

## 开发

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test（单元测试）
npm run build       # 使用 @vercel/ncc 打包到 dist/
```

`dist/` 会被提交到仓库，以便 Action 直接从仓库运行。每当你修改 `src/` 下的任何
内容，都要重新构建并提交 `dist/`。

## 许可证

GPL-3.0
