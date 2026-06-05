# MVP 模块：Check, Hatch, CLI and GUI

## CLI

默认 feng 命令：

```text
feng grow "goal"
feng check
feng hatch --name NAME --portable
feng status
feng watch
feng artifacts
feng gui
feng config
```

`grow` 是第一个语义入口。bootstrap 是 `grow` 的前置动作，不是用户必须理解的独立命令。

## grow

`grow` 行为：

```text
1. 创建或读取 .feng 实例。
2. 把本次输入写入 inbox。
3. 进入长程 loop。
4. 自动编译 messages、调用 LLM、执行工具、写 artifacts。
5. candidate 变化后运行 check。
6. check 失败则继续修复，直到 done/blocked/budget/missing_config。
```

用户多次 `grow` 是给同一个实例补信息，不是重开 session。

## check

check 验证 `.feng` 实例和当前 workspace candidate 是否可推进。

最低验证：

```text
.feng 能加载
skills/tools/prompts/world/evals 基本 schema 正确
raw inbox 不被当作稳定能力
world/tools/skills/evals 能形成最小能力闭环
permissions 可解析
active tool pack 可生成
message compiler 可编译
provider profile 不含 secret
如果 workspace 有 Go runtime/source，go test ./... 通过
evals 可运行
没有 feng 自举专用 runtime 分支
```

失败：

```text
不推进 validated instance
写 check-report artifact
写 diff/test artifact
state.candidate_status = failed
last_recovery 指向失败 artifact
```

通过：

```text
更新 validated instance
记录 history snapshot
标记本轮可 hatch 的能力子集
state.candidate_status = validated
```

## hatch

`hatch` 从 validated instance 打包命名命令：

```text
feng hatch --name xiaopi --portable
```

package：

```text
dist/xiaopi/
  xiaopi
  xiaopi.cmd
  xiaopi.ps1
  feng-runner
  feng-runner.exe
  self/
    identity.md
    skills/
    tools/
    prompts/
    world/
    evals/
    interface.yaml
    permissions.yaml
    config.schema.yaml
  provider-examples/
  xiaopi-release.yaml
  checksums.json
  install
  install.ps1
```

`self/` 是产品稳定能力。它随 package 发布，不展开到用户 workspace。

hatch 打包的是 validated ability subset，不是完整 `.feng/`：

```text
include:
  validated skills/tools/prompts/world/evals/interface/permissions/config schema

exclude:
  inbox raw input
  messages
  runs
  artifacts
  local history
  provider profile
  secrets
```

## Execute Mode

使用者运行：

```text
cd user-workspace
xiaopi "整理发票"
```

runtime 读取：

```text
package/self        stable product self
user-workspace      task workspace
user-workspace/.xiaopi local state/artifacts/config/history
```

用户目录生成：

```text
.xiaopi/
  state.yaml
  lock
  events.jsonl
  runs/
  artifacts/
  history/
  config.yaml
```

如果 package self 的 interface 仍然是默认 feng interface，命名命令继续暴露 grow/check/hatch；这用于下一代 feng 自举。普通产品命令默认进入 execute mode。

## config

provider profile 是本机配置，不进入 `.feng/skills`，也不进入 package self。

```text
feng config status
feng config init
xiaopi config status
xiaopi config init
```

config init 只写 profile 模板，不保存 API key。密钥通过 env 引用。

## GUI

GUI MVP 只读：

```text
Running
Progress
Artifacts
Messages/token report
```

GUI 读取实例目录文件，不提供 CLI 没有的能力。

## 参数要求

```text
未知参数必须报错。
--name / --out / --max-turns 这类值缺失必须报错。
status/check/artifacts 默认无额外参数。
watch --limit N 只接受正整数。
```

## 不变量

```text
hatch 不包含 API key。
hatch 不包含本机 provider profile。
hatch 不包含未验证 candidate。
execute mode 不修改 package self。
用户 workspace 只出现 .产品名 运行态。
```
