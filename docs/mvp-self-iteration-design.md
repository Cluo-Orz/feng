# Feng MVP 自迭代设计

## 1. MVP 目标

MVP 只有一个目标：

```text
让 feng 用通用逻辑迭代 feng 自己。
```

具体表现为：

```text
feng grow "改进 feng 自己"
feng check
feng hatch --name feng --portable
```

这不是为 feng 写一个专用 agent，也不是创造另一个专用自举命令。MVP 必须证明：

```text
同一套 Runtime Kernel
同一套 Self Repo
同一套 .feng State
同一套 Git 成长模型
同一套 LLM / Tool / Message / Permission 机制
```

可以用于任意 agent，也可以用于 feng 自己。

## 2. 非目标

MVP 不做：

```text
多 agent 协作
复杂 GUI
插件市场
复杂长期记忆
复杂 hook 脚本系统
复杂 provider router
自动模型 benchmark
完整跨平台安装器
完整用户应用生态
```

MVP 也不做 feng 专用逻辑：

```text
不写 if project == 当前项目名
不写专用自举命令
不写自举专用 runtime
不写自举专用 prompt 通道
不绕过 permissions
不自动重写 Git 历史
```

## 3. 成功标准

MVP 成功标准：

```text
1. 第一次 grow 能在普通目录 bootstrap 一个 feng workspace，或识别已有 workspace。
2. 能读取当前 feng 文档、源码、review 轮次和 Git 状态。
3. 能用 LLM 生成修改计划。
4. 能通过 tool call 读取、写入文件、列目录、运行受限命令。
5. 能把长输出写入 .feng/artifacts/，message 中只保留 artifact refs。
6. 能修改 self repo 中的 docs/specs/skills/evals 或源码。
7. 能保留 candidate working tree。
8. 能运行 check，失败时保留失败现场，不强制回滚。
9. 能从 validated commit 启动并修复 candidate。
10. 能在 check 通过后提交 validated commit。
11. 能 hatch --name feng --portable，产出下一版 feng 命令。
12. 产出的 feng 可以在另一个目录继续执行 grow/check/hatch。
```

## 4. 顶层结构

MVP 只实现四个对象：

```text
Runtime Kernel
  稳定小内核。负责 CLI、loop、LLM adapter、message compiler、tool dispatcher、permissions、check、hatch、state、Git。

Self Repo
  文件化自我。表达 identity、goal、skills、hooks、tools、world、evals、interface、permissions、config schema。

.feng State
  当前 workspace 的状态、事件、产物、缓存和锁。

Git
  self 的成长历史。表达 candidate、validated commit、tag。
```

不要再拆更大的系统。

## 5. Workspace 结构

MVP workspace：

```text
.
  identity.md
  goal.md
  feng.yaml
  hooks.yaml
  permissions.yaml
  interface.yaml
  config.schema.yaml
  skills/
  tools/
  world/
  evals/
  .feng/
    state.yaml
    lock
    events.jsonl
    artifacts/
    cache/
    runs/
  .git/
```

对 feng 自举来说，当前 `docs/`、未来 `src/`、测试和构建脚本属于被感知的 world 和可修改目标。它们不是特殊 runtime。

## 6. CLI

MVP CLI 只做：

```text
feng grow "..."
feng check
feng hatch --name feng --portable
feng status
feng watch
feng artifacts
```

说明：

```text
grow
  第一个语义入口。用户给目标，kernel 持续推进 candidate。
  如果当前目录还不是 workspace，先执行通用 bootstrap。

check
  验证 candidate 是否可成为 validated self。

hatch
  从 validated self 产出命名命令。

status/watch/artifacts
  可观测性入口。
```

第一次 `grow` 的通用 bootstrap：

```text
创建最小 self repo
创建 .feng/
如果没有 Git，则初始化 Git
写入初始 state
如果缺少 provider 配置，则进入 missing_config
```

bootstrap 不覆盖已有文件。已有 docs、src、tests、脚本和配置先作为当前 world 的一部分被感知，只有缺失的 self 文件和 `.feng/` 状态会被补齐。

bootstrap 不是单独产品命令。它只是 `grow` 在非 workspace 目录中的前置阶段。

## 7. Self Repo 初始内容

MVP 自迭代 self repo 的初始内容可以由 builtin template 生成。对于已有 feng 仓库，template 的作用是补齐缺失的 self 文件，不是复制或覆盖整个项目。

### identity.md

```text
这是一个 feng self。
不要假设当前项目已经具备领域能力。
稳定能力必须通过 grow 生成 candidate，并通过 check 后才能成为 validated self。
```

### goal.md

```text
初始 goal 来自本次 grow 的用户输入。
goal.md 可以在 grow 过程中被更新为稳定目标，但不能在模板中预置某个项目目标。
```

### world/

```text
world/README.md
  说明 world/ 用来存放稳定世界模型，不存运行日志。
```

world 是说明书，不存运行日志。当前仓库结构、文档含义和 review 方法必须由 grow 通过读文件、列目录、运行命令感知后，再作为 candidate world 写入。

### skills/

MVP 不预置任何项目 skill。

```text
skills/README.md
  说明 skill 是通过 grow 长出来的能力契约。
```

第一个 grow 可以创建读取需求、审查文档、编辑 self、修复 candidate 等 skill，但这些必须是本轮 candidate 的产物，而不是模板预先准备好的能力。

MVP skill 文件只需要表达最小能力契约：

```text
when
goal
context
tools
output
checks
```

skill 可以提供 prompt 文本，但 message compiler 才决定本轮放入哪些内容。

### hooks.yaml

MVP hook 可以为空或只声明事件名：

```yaml
on_grow: []
on_check_failed: []
```

如果 hook 没有匹配 skill，kernel 使用通用 seed loop：latest event + self index + 文件索引 + 初始工具 + artifact refs。LLM 可以在这个 loop 中生成第一批 candidate skills/hooks/world/evals。

MVP 不做 hook 脚本执行器。

### tools/

初始工具只有：

```text
read_file
write_file
list_files
run_command
```

领域工具可以后续 grow 出来，但 MVP 不依赖它。

### evals/

MVP eval：

```text
evals/load-self.yaml
  self repo 必须能加载。

evals/schema.yaml
  self repo 的 YAML/Markdown 结构必须能解析。

evals/permission-boundary.yaml
  permissions.yaml 必须能被解析并阻止危险操作。

evals/no-secret.yaml
  self repo、artifact 和 hatch package 不得包含真实 API key。

evals/llm-provider-boundary.yaml
  LLM provider 必须是配置 profile，不写真实 key。
```

MVP 默认 eval 只验证 self 健康、schema、权限、provider 边界和 secret 边界。针对当前项目的业务 eval，例如架构 review 是否 case-first，必须由 grow 生成 candidate eval。

## 8. LLM Provider

MVP 使用 provider-neutral 调用层：

```text
LLMRequest
LLMResponse
Message
Tool
ToolCall
ToolResult
Usage
Capability
ProviderProfile
```

MVP 至少实现一个可用 adapter：

```text
openai_chat
```

同时保留 Anthropic Messages adapter 接口。

DeepSeek 作为 provider profile：

```yaml
id: deepseek
protocol: openai_chat
base_url: https://api.deepseek.com
api_key_env: DEEPSEEK_API_KEY
model_env: FENG_LLM_MODEL
example_model: deepseek-chat
```

API key 不进入 self repo、Git、artifact 或 hatch package。

provider profile 可以来自用户级配置、显式配置路径或 `.feng/` 下的本机未跟踪配置。MVP 不做 provider router，也不把 provider profile 当成 self repo 的一部分。

## 9. Message Compiler

MVP message compiler 只做一件事：

```text
把 self repo + .feng state + Git + latest event 编译成 token-efficient messages。
```

顺序：

```text
provider tools
system: kernel contract
system: self contract
optional cached context pack
user: state manifest
conversation suffix
user: latest event
```

规则：

```text
稳定前缀尽量不变。
动态内容放后面。
大内容写 artifact。
message 里只放 artifact refs。
assistant 不长期保存推理。
tool response 长结果文件化。
```

ArtifactRef 最小字段：

```yaml
type: diff
source: git
path: .feng/artifacts/...
hash: "..."
summary: "..."
why_relevant: "..."
snippets: []
```

## 10. Active Tool Pack

MVP active tool pack 规则：

```text
bootstrap tools 可用。
领域工具由当前 hook/skill 选择；没有 skill 时由通用 seed loop 选择最小必要工具。
每轮只暴露需要的 tool schema。
工具说明全文留在 tools/ 文件中，必要时 read_file。
每次 tool call 仍经过 permissions。
```

自迭代场景下，默认 active tool pack：

```text
read_file
write_file
list_files
run_command
```

如果后续 grow 出 git helper 或 doc checker，也仍然按 hook/skill 选择，不自动全量暴露。

## 11. Permissions

MVP permission 只做本地边界：

```yaml
files:
  read:
    - docs/**
    - src/**
    - tests/**
    - "*.md"
  write:
    - docs/**
    - src/**
    - tests/**
commands:
  allow:
    - git status
    - git diff
    - git log
    - rg
    - npm test
    - pytest
    - cargo test
    - go test
  deny:
    - git reset --hard
    - git push
    - rm -rf
```

MVP 不需要复杂沙箱，但每次 tool call 必须经过 permission check。

危险操作必须失败，并写入 artifact。

LLM 可以通过允许的 git 命令读取事实，例如 status、diff、log。更新 validated commit、创建 checkpoint commit、创建 hatch tag 是 kernel 在 check/hatch 通过后的动作，不是 LLM 任意 `run_command` 的结果。

## 12. Grow Loop

MVP grow loop：

```text
1. acquire .feng/lock
2. read .feng/state.yaml
3. read Git state
4. read self repo index
5. select hook/skill；如果没有匹配 skill，进入通用 seed loop
6. select active tool pack
7. compile messages
8. call LLM
9. execute tool calls with permission check
10. write artifacts/events/state
11. repeat until task done, blocked, or budget reached
12. release lock
```

状态写入：

```text
.feng/state.yaml
  mode: growing | checking | blocked | ready
  current_goal
  validated_commit
  candidate_status
  last_event_id
  last_artifacts

.feng/events.jsonl
  append-only event stream

.feng/artifacts/
  diff、tool output、check report、review report、hatch preview
```

## 13. Git 成长模型

MVP Git 语义：

```text
validated commit
  上一次 check 通过的 self。

working tree
  当前 candidate。

tag
  可 hatch 的命名版本。
```

失败策略：

```text
check 失败不自动丢弃 candidate。
validated commit 仍是运行基线。
失败报告、diff、tool output 写入 artifacts。
下一轮 grow 读取 artifact refs 修复 candidate。
```

只有 check 通过才可以更新 validated commit。

LLM 修复 self 的方式是读取 Git 报告、diff 和失败 artifact，然后继续编辑 working tree。Git commit/tag 由 kernel 在验证通过后执行，避免把版本推进权交给一次普通 tool call。

## 14. Check

MVP check 只验证最低可行性：

```text
self repo 能加载
YAML/Markdown schema 能解析
hooks.yaml 能解析
permissions.yaml 能解析
tools 能加载
active tool pack 能生成
message compiler 能编译
provider profile 能解析，但不要求真实调用
evals 能运行
禁止特殊 runtime 检查通过
candidate 声明的项目业务 eval 能运行；如果还没有业务 eval，不因此失败
```

自迭代 check 还要验证：

```text
没有专用自举命令
没有 project == 当前项目名 的 runtime 分支
没有真实 API key
没有默认 push / reset / delete history
```

Check 结果规则：

```text
check 失败
  不更新 validated_commit。
  不提交 validated checkpoint。
  写入 .feng/artifacts/check-report-*.md。
  .feng/state.yaml 标记 candidate_status: failed。

check 通过
  更新 .feng/state.yaml 的 validated_commit。
  可以创建 Git checkpoint commit。
  .feng/state.yaml 标记 candidate_status: validated。
```

`hatch` 只能从 `validated_commit` 打包，不能从未验证 working tree 打包。

## 15. Hatch

MVP hatch：

```text
feng hatch --name feng --portable
```

输出：

```text
dist/feng/
  feng
  feng.ps1
  runner/
  self/
  provider-examples/
  feng-release.yaml
  checksums.json
```

manifest：

```yaml
name: feng
self_commit: "..."
runner_version: "..."
required_provider_profiles:
  - deepseek
required_env:
  - DEEPSEEK_API_KEY
permissions_summary: "..."
interface:
  commands:
    - grow
    - check
    - hatch
    - status
    - watch
    - artifacts
```

Hatch 不包含：

```text
API key
本机 provider profile
.feng/runs
.feng/cache
未通过 check 的 candidate
```

Hatch 可以包含 provider example：

```text
provider-examples/deepseek.yaml
```

但 example 只能包含：

```text
protocol
base_url
api_key_env
model
capabilities
```

不能包含真实 API key。

## 16. Execute

产物 `feng` 在另一台机器上运行：

```text
feng grow "..."
feng check
feng hatch --name feng --portable
```

这是因为本 MVP hatch 出来的命名命令仍然叫 `feng`，所以它的 execute interface 仍然是 grow/check/hatch。普通目标 agent 的 hatch 产物则执行 `interface.yaml` 暴露的业务命令，例如 `xiaogui`、`coder`、`newsbrief`。

execute mode 默认读取 frozen self、本机 config 和本次 args，不修改 packaged self。若使用者要让它继续成长，应在一个 feng workspace 中再次进入 grow mode。

如果缺少 provider profile 或 API key：

```text
feng status 显示 missing_config。
feng grow 不启动 LLM。
提示 provider profile 路径、需要的 env 名称和 provider example。
```

## 17. 可观测性

MVP 可观测性：

```text
feng status
  当前 mode、goal、candidate、validated commit、最近错误、缺失配置。

feng watch
  读取 .feng/events.jsonl。

feng artifacts
  列出 artifacts，显示 type/source/path/hash/summary/why_relevant。
```

GUI MVP 只读：

```text
Running
Progress
Artifacts
```

GUI 不提供额外能力，不绕过 CLI 和 permissions。

## 18. MVP 端到端路径

```text
1. 开发者安装 feng runner。
2. 配置 provider profile 和 DEEPSEEK_API_KEY。
3. 在 feng 仓库执行 feng grow "根据核心诉求改进 MVP 自迭代设计"。
4. 如果当前目录不是 workspace，grow 先执行通用 bootstrap。
5. kernel 读取 self repo、docs、Git、.feng state。
6. message compiler 生成 token-efficient messages。
7. LLM 通过 tool call 读取/写入文件、运行检查。
8. 长输出进入 artifacts。
9. candidate 形成。
10. 执行 feng check。
11. 失败则保留 artifacts，继续 grow 修复。
12. 成功则更新 validated commit。
13. 执行 feng hatch --name feng --portable。
14. 在新目录运行 dist/feng/feng grow "..."。
15. 新 feng 先 bootstrap 当前目录，再继续 grow/check/hatch。
```

## 19. MVP 风险

### 风险一：通用逻辑不够强，自迭代效果弱

处理：

```text
先要求能修改 docs/specs。
代码生成能力不作为第一验收门槛。
```

### 风险二：check 太弱，坏 candidate 被 promote

处理：

```text
MVP check 保守。
只在 self 加载、message compiler、permissions、evals 都通过时更新 validated commit。
```

### 风险三：LLM 输出误操作

处理：

```text
所有工具调用走 permission check。
危险命令 deny。
失败写 artifact。
```

### 风险四：context 过大

处理：

```text
artifact refs。
active tool pack。
stable prefix + dynamic suffix。
```

### 风险五：自举变成 feng 专用逻辑

处理：

```text
check 禁止特殊 runtime。
review 必须证明同一机制可用于普通 agent。
```

## 20. MVP 不变量

```text
不能把 API key 写进仓库。
不能为 feng 自己开特殊通道。
不能跳过 permissions。
不能 check 失败还 promote。
不能自动丢弃失败 candidate。
不能把长日志塞进 prompt。
不能把所有工具 schema 每轮全量暴露。
不能让 GUI 拥有 CLI 没有的能力。
```

## 21. 下一步实现顺序

```text
1. Self repo loader。
2. .feng state/events/artifacts。
3. Permission checker。
4. Bootstrap tools。
5. Provider profile loader。
6. OpenAI-compatible LLM adapter。
7. Message compiler。
8. Tool dispatcher。
9. Grow loop。
10. Check runner。
11. Git validated commit marker。
12. Hatch package builder。
13. status/watch/artifacts CLI。
14. 只读 GUI。
```
