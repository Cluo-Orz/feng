# 第 9 轮推演报告

## 1. 本轮目的

本轮修正前几轮推演过浅的问题。

推演不再只看：

```text
new -> grow -> check -> hatch
```

而是按 `docs/core-requirements.md` 的 `R01-R20` 验收面，检查当前架构是否真正覆盖原始诉求。

## 2. R01-R20 总体验收

| 编号 | 诉求 | 当前状态 | 依据 |
| --- | --- | --- | --- |
| R01 | LLM 对接 | 满足概念 | Runtime Kernel 负责 LLM adapter，self repo 不感知 provider 差异。 |
| R02 | Function Call | 满足概念 | 内部统一 Message / Tool / ToolCall，loop 中有 call tool。 |
| R03 | 自造工具 | 满足概念 | grow 可以修改 tools/，check 验证 tool 加载和权限。 |
| R04 | Token Efficiency | 满足概念 | 第 7 轮已改成 stable prefix + dynamic suffix + artifact refs。 |
| R05 | 协议兼容 | 满足概念 | OpenAI / Anthropic 作为 adapter 差异，内部协议统一。 |
| R06 | Message 编排 | 满足概念 | 已明确 provider tools、system、user、assistant、tool response 边界。 |
| R07 | Prompt / Skill 模块化 | 满足概念 | skill 是成长单位，hook 是介入时机，message 是运行时编译结果。 |
| R08 | GUI 和 CLI | 满足概念 | CLI 是主路径，GUI 是 .feng 文件的只读可视化。 |
| R09 | 初始工具 | 满足概念 | bootstrap tools 明确为 read_file/write_file/list_files/run_command。 |
| R10 | 白板孵化 | 满足概念 | feng new 创建起始 self，能力由 grow 长出来。 |
| R11 | 文件即自我 | 满足概念 | self repo 文件约定已列出。 |
| R12 | Git 成长 | 满足概念 | validated commit、candidate、tag 的语义已定义。 |
| R13 | Reload / Repair | 满足概念 | candidate 失败后从 validated commit 启动并修复 working tree。 |
| R14 | World | 满足概念 | world/ 是稳定环境说明书。 |
| R15 | 长任务 | 满足概念 | grow 是长任务，但用户不接触 session/resume。 |
| R16 | 可观测性 | 满足概念 | .feng/state.yaml、lock、events、artifacts 和 status/watch/artifacts。 |
| R17 | 打包传播 | 满足概念 | hatch 输出命名命令和 release package。 |
| R18 | 配置和权限 | 满足概念 | config.schema.yaml、permissions.yaml、tool call permission check。 |
| R19 | 自举 | 满足概念 | `feng hatch --name feng --portable` 是自举验证。 |
| R20 | 简单和不过拟合 | 满足概念 | 核心对象保持 Runtime Kernel + Self Repo + .feng State + Git。 |

本轮没有发现“架构概念缺失”的硬缺口。剩余细节主要进入实现规格。

## 3. 通用生命周期细化

### 3.1 new

`feng new <name>` 不是启动一个智能 agent，而是创建一个可成长的 self repo。

当前架构期望产生：

```text
identity.md
goal.md
skills/
hooks.yaml
tools/
world/
evals/
interface.yaml
permissions.yaml
config.schema.yaml
feng.yaml
.feng/
Git repo
```

满足：

```text
R10 白板孵化
R11 文件即自我
R14 World
R18 配置和权限
```

### 3.2 grow

`feng grow "..."` 是长任务入口。

kernel 每轮做：

```text
读取 self repo / Git / .feng state
编译 token-efficient message list
调用 LLM adapter
接收 assistant tool call
执行 read_file / write_file / list_files / run_command 或 self repo 中的领域工具
把 tool response 写回 message 或 artifact ref
必要时修改 skills、tools、world、evals、interface、permissions
写入 .feng/events.jsonl 和 artifacts
保留 candidate working tree
```

满足：

```text
R01 LLM 对接
R02 Function Call
R03 自造工具
R04 Token Efficiency
R05 协议兼容
R06 Message 编排
R07 Prompt / Skill 模块化
R09 初始工具
R15 长任务
R16 可观测性
```

### 3.3 message list

每轮 message list 不是把所有材料塞进去，而是编译成：

```text
provider tools
system: kernel contract
system: self contract
optional cached context pack
user: state manifest
conversation suffix
user: latest event
```

角色边界：

```text
system
  放稳定规则、权限边界、工具协议、self 摘要。

user
  放当前状态 manifest、最新事件、文件引用、任务特定输出要求。

assistant
  只放稳定 few-shot 或最近必要行动历史，不保存长推理。

tool response
  短结果直接返回，长结果写 artifact，只回传路径、hash、summary、关键片段。
```

满足：

```text
R04 Token Efficiency
R05 协议兼容
R06 Message 编排
R07 Prompt / Skill 模块化
```

### 3.4 tool growth

初始工具只有：

```text
read_file
write_file
list_files
run_command
```

领域工具通过 grow 写入 self repo：

```text
tools/http_request
tools/openapi_case_runner
tools/sensor_read
tools/motor_control
tools/windows_file_plan
```

check 需要验证：

```text
tool schema 能解析
工具实现能加载
权限边界能拦截危险调用
tool response 能按短结果/长 artifact 规则返回
```

满足：

```text
R02 Function Call
R03 自造工具
R09 初始工具
R18 配置和权限
```

### 3.5 Git / repair

grow 的修改先形成 candidate working tree。

失败时：

```text
不强制丢弃 candidate
validated commit 仍可作为启动基线
失败 diff、验证报告、tool output 写入 .feng/artifacts/
agent 读取失败现场继续修复 candidate
```

通过时：

```text
candidate -> validated commit
目标达成 -> tag
tag 或 validated commit -> hatch
```

满足：

```text
R12 Git 成长
R13 Reload / Repair
R19 自举
```

### 3.6 check

`feng check` 不追求复杂 CI，只回答：

```text
self 能不能加载
schema 能不能解析
tool 能不能加载并受权限约束
核心 eval 能不能通过
还缺什么 config 或 permission
```

满足：

```text
R03 自造工具
R12 Git 成长
R13 Reload / Repair
R18 配置和权限
```

### 3.7 hatch / execute

`feng hatch --name <name> --portable` 产生：

```text
命名入口
runner
self/
manifest
checksums
install 脚本
```

使用者只运行：

```text
<name>
<name> --help
<name> <args>
```

使用者机器上的密钥、路径、设备地址进入 config，不打进 self。

满足：

```text
R08 GUI 和 CLI
R17 打包传播
R18 配置和权限
R20 简单和不过拟合
```

## 4. 七个 case 详细推演

### 4.1 Coding Agent

目标命令：

```text
coder
```

生命周期：

```text
new
  identity.md 写明 coder 是本地代码助手。
  world/ 描述项目结构、Git、测试、构建约定。
  permissions.yaml 默认允许读写项目文件、运行受限 test/build/lint。
  interface.yaml 暴露 coder "任务"、coder review、coder test。

grow
  用户输入“修复测试、审查代码、解释代码”。
  agent 用 list_files/read_file 理解项目。
  修改 skills/code-review.md、skills/test-debug.md。
  如需要，新增 tools/git_diff 或 tools/test_runner，但第一版可以用 run_command。

message list
  system 前缀包含代码助手边界和权限。
  self contract 包含 active skill index。
  state manifest 放 Git status、当前失败测试 artifact path、相关文件路径。
  latest event 放用户当前任务。

context / cache
  完整测试日志和大 diff 进入 .feng/artifacts/。
  prompt 只放失败摘要、文件路径、hash、关键片段。

check
  fixture 项目中验证能修复简单测试失败。
  验证 run_command 只跑允许命令。

hatch / execute
  hatch 后用户运行 coder，不需要理解 feng。
```

需求覆盖：

```text
覆盖 R01-R18。
R19 不直接适用，但同样机制可用于 feng 自举。
R20 满足：没有 coding 专用 runtime。
```

### 4.2 API Testing Agent

目标命令：

```text
apitest
```

生命周期：

```text
new
  world/ 描述 OpenAPI、endpoint、auth、schema mismatch。
  config.schema.yaml 定义 token、base-url。
  permissions.yaml 限定可访问域名。
  interface.yaml 暴露 smoke、case、report。

grow
  agent 读取 openapi.yaml，生成 endpoint index。
  新增 skills/api-smoke.md、skills/schema-check.md。
  自造或声明 http_request / openapi_case_runner 工具。

message list
  provider tools 只包含 active HTTP 工具和 bootstrap tools。
  system contract 保持权限和请求边界稳定。
  user state manifest 放 spec path、endpoint index hash、报告 artifact path。
  latest event 放本轮要测的 endpoint 或 smoke/regression。

context / cache
  完整 OpenAPI 文件放文件引用。
  本轮只注入相关 endpoint schema 片段。
  HTTP 长响应写 artifact，prompt 留摘要。

check
  mock API 下验证能发现状态码和 schema 错误。
  验证 token 不进入日志和 artifacts 摘要。

hatch / execute
  使用者运行 apitest，首次配置 token/base-url。
```

需求覆盖：

```text
R01-R18 满足。
R04 关键：OpenAPI 全文不每轮塞入 prompt。
R20 满足：HTTP 工具是 self repo 工具，不是新平台模块。
```

### 4.3 新闻汇总 Agent

目标命令：

```text
newsbrief
```

生命周期：

```text
new
  world/ 描述 RSS、网页文章、时间范围、引用规则。
  permissions.yaml 限定新闻源和网络访问范围。
  interface.yaml 暴露 daily、topic、format。

grow
  agent 学会去重、聚类、摘要、引用保留。
  新增 tools/rss_fetch 或 tools/web_fetch。
  evals/ 使用示例文章检查去重和时间过滤。

message list
  system contract 放事实/推测/观点区分规则。
  cached context pack 可放固定摘要格式和引用格式。
  state manifest 放 source list path、article artifact refs。
  latest event 放 topic、since、limit。

context / cache
  网页正文和抓取结果进入 artifacts。
  prompt 只放标题、来源、时间、短摘要、路径和 hash。

check
  示例文章验证不把旧新闻当新新闻。
  验证每条摘要保留来源链接。

hatch / execute
  使用者运行 newsbrief，不需要理解 feng。
```

需求覆盖：

```text
R01-R18 满足。
R04 和 R14 是核心：新闻正文属于 artifact，稳定 source/world 才进入 self。
R20 满足：不需要长期记忆系统。
```

### 4.4 小车 Agent

目标命令：

```text
carbrain
```

生命周期：

```text
new
  world/ 描述传感器、电机控制、速度限制、安全停止条件。
  config.schema.yaml 保存设备地址、校准参数。
  permissions.yaml 限制高速、持续前进、忽略障碍物。
  interface.yaml 暴露 patrol、stop、calibrate。

grow
  用户提供小车控制方式和感知方式。
  agent 新增 sensor_read、motor_control 等工具声明。
  agent 写入 skills/avoid-obstacles.md 和 evals/simulator-cases。

message list
  system contract 放安全边界，必须稳定且靠前。
  self contract 放当前控制策略版本和工具 index。
  state manifest 放最近传感器 artifact refs。
  latest event 放当前传感器摘要或用户命令。

context / cache
  原始传感器流不进 prompt，进入 artifacts。
  每轮只注入最近状态和安全相关片段。

check
  模拟传感器下验证停止、转向、安全降级。
  tool permission 拦截危险控制。

hatch / execute
  使用者运行 carbrain patrol --speed low。
  本机设备地址来自 config，不打进 release self。
```

需求覆盖：

```text
R01-R18 满足。
R13 重要：错误策略 candidate 不应自动吞掉，应保留失败现场用于修复。
R20 满足：小车不是特殊 runtime，只是 world + tools + permissions。
```

### 4.5 Windows 桌面助手 Agent

目标命令：

```text
deskhelper
```

生命周期：

```text
new
  world/ 描述 Windows 文件系统、授权目录、文件分类规则。
  config.schema.yaml 保存用户目录偏好。
  permissions.yaml 限定读写目录和 PowerShell 命令范围。
  interface.yaml 暴露 organize、find、cleanup、dry-run。

grow
  用户提供整理规则和示例。
  agent 修改 skills/file-organize.md、evals/sample-downloads。
  需要时新增 file_plan 工具；执行仍通过受限 run_command。

message list
  system contract 放不删除、不读敏感目录、先 dry-run 的规则。
  state manifest 放目录扫描 artifact path 和候选操作摘要。
  conversation suffix 保留最近确认动作。
  latest event 放本轮整理或查找请求。

context / cache
  完整文件列表写 artifact。
  prompt 只放分组摘要、候选变更、路径引用。

check
  示例目录验证 dry-run 不修改文件。
  实际执行前验证需要确认。

hatch / execute
  使用者运行 deskhelper，按 config 首次授权目录。
```

需求覆盖：

```text
R01-R18 满足。
R16 重要：artifact 应展示操作计划和执行结果。
R20 满足：不需要桌面专用复杂系统。
```

### 4.6 Claude Code 会话管理 Agent

目标命令：

```text
ccmanage
```

生命周期：

```text
new
  world/ 描述项目目录、会话摘要、diff、handoff 文档。
  permissions.yaml 默认只读代码，允许写 handoff。
  interface.yaml 暴露 summarize、handoff、status、next。

grow
  agent 学会抽取已完成、未完成、风险和阻塞点。
  新增 skills/session-summary.md、skills/handoff.md。
  可能新增 git_status/git_diff helper，但 run_command 足够启动。

message list
  system contract 放默认不修改业务代码。
  state manifest 放 Git diff path、会话记录 path、已有 handoff path。
  latest event 放 summarize/handoff/next 请求。

context / cache
  长会话和命令输出文件化。
  prompt 只放压缩摘要、待办、风险和引用。

check
  示例项目验证 handoff 准确区分完成/未完成/风险。
  验证默认不改代码。

hatch / execute
  使用者运行 ccmanage handoff。
```

需求覆盖：

```text
R01-R18 满足。
R04 是核心：该 agent 本身就是 context 压缩场景。
R20 满足：不需要读取隐私目录的特殊后门。
```

### 4.7 Feng 自举

目标命令：

```text
feng
```

生命周期：

```text
new
  对 feng 自己而言，当前仓库就是 workspace。
  world/ 描述核心诉求、架构文档、评审轮次、源码、测试、Git 历史。

grow
  agent 读取 core-requirements、architecture、agent expectations。
  根据 R01-R20 生成详细推演。
  修改 docs 或未来源码。
  运行检查并留下 .feng artifacts。

message list
  system contract 放不过拟合、架构简单、禁止特殊 runtime。
  self contract 放当前 feng self commit 和 active skill index。
  state manifest 放本轮 review 目录、上一轮报告路径、当前 diff。
  latest event 放用户的新要求。

context / cache
  历史轮次报告不全文塞入 prompt。
  每轮只放 relevant refs、摘要、hash。
  需要时 read_file 指定轮次。

git / repair
  candidate 文档或代码失败时保留 diff。
  validated commit 仍能启动。
  agent 用 Git 报告、check 输出和 artifacts 修复自己。

check
  验证 docs 结构、核心诉求覆盖、基础 CLI 或未来测试。

hatch / execute
  `feng hatch --name feng --portable` 产出下一版 feng。
```

需求覆盖：

```text
R01-R20 全部适用。
R19 是核心验收：自举不能引入 fengsmith 或特殊 runtime。
```

## 5. 细节缺口判断

本轮发现的缺口不是架构概念缺口，而是推演方法缺口。

之前推演过于简化，没有系统覆盖：

```text
角色级 message 编排
tool response 截断和 artifact 化
active tool pack 对自造工具的影响
Git 失败现场如何被 agent 用来修复
GUI/CLI 可观测性如何进入每个 case
hatch 后使用者和创造者边界
R01-R20 原始诉求逐项验收
```

本轮已通过两处文档修正这个问题：

```text
docs/core-requirements.md 增加 R01-R20 原始诉求验收面。
docs/architecture-review/review-method.md 增加详细推演方法。
```

## 6. 客观结论

当前架构本身仍然保持自洽。

需要改进的是 review 方法，而不是继续扩写架构概念：

```text
架构主线：满足
原始诉求覆盖：满足概念
实现细节：待最小实现规格
过拟合风险：当前可控
```
