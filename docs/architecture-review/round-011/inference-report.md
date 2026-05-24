# 第 11 轮推演报告

## 1. 本轮目的

本轮修正一个推演方法错误：

```text
推演必须按每个 case 展开，而不是先做整体推演再套到 case 上。
```

因此本轮以七个目标 agent 为一级结构。每个 case 都单独检查：

```text
new
grow
message list
tool growth
context / cache
git / repair
check
hatch
execute
observability
R01-R20 覆盖
```

## 2. Case：Coding Agent

### 2.1 生命周期推演

```text
new
  feng new coder 创建空白 self。
  identity.md 写明 coder 是本地代码助手。
  world/ 描述代码仓库、测试、构建、Git diff、错误日志。
  permissions.yaml 允许读写项目文件、运行受限 test/build/lint。
  interface.yaml 暴露 coder "任务"、coder review、coder test、coder --dry-run。
  evals/ 放 fixture 项目和失败测试样例。

grow
  用户给目标：修复测试、审查代码、解释代码。
  loop 读取文件 -> 编译 message list -> 调 LLM -> tool call -> 执行工具 -> tool response -> 再读文件。
  初始只用 read_file/write_file/list_files/run_command。
  grow 可沉淀 skills/test-debug.md、skills/code-review.md、skills/explain-code.md。
  如果 run_command 包装不够，可在 tools/ 新增 test_runner 或 git_diff helper。

message list
  provider tools：bootstrap tools + 当前代码相关 active tool pack。
  system: kernel contract：工具调用协议、权限边界、输出约束。
  system: self contract：coder 身份、goal、self commit、active skill index。
  user: state manifest：Git status、失败测试 artifact、相关文件路径。
  conversation suffix：最近必要 tool call / tool response。
  user: latest event：用户当前修复或 review 请求。

context / cache
  项目规则、代码 skill index、权限摘要进入稳定前缀。
  最新失败、当前 diff、用户任务进入动态后缀。
  长测试输出、完整 diff、大文件内容写 .feng/artifacts/，prompt 只放 path/hash/summary/关键片段。

git / repair
  修改代码和 self 先形成 candidate。
  check 失败时保留 diff、测试日志和失败报告。
  下一轮从 validated commit 启动，读取 artifact refs 修复 candidate。

check
  self 能加载。
  tool schema 能解析。
  run_command 只运行允许命令。
  fixture 测试能通过。

hatch
  validated self 生成 coder portable package。
  manifest 记录 self commit、runner、permissions、interface、checksums。

execute
  使用者运行 coder，不需要理解 feng。
  首次运行读取本地 config，例如默认测试命令。

observability
  feng status 看是否在 grow/check。
  feng watch 看事件流。
  feng artifacts 看 diff、测试日志、失败报告。
  GUI 只读展示 running/progress/artifacts。
```

### 2.2 R01-R20 覆盖

```text
R01 满足：通过 LLM adapter 做代码分析和计划。
R02 满足：read_file/write_file/run_command 都通过 ToolCall。
R03 满足：可 grow 出 test_runner/git_diff，但不是必须。
R04 满足：测试日志和 diff 文件化，稳定前缀可缓存。
R05 满足：内部 Message/ToolCall 可编译到 OpenAI/Anthropic。
R06 满足：system 放边界，user 放状态和任务，assistant/tool 保持协议短历史。
R07 满足：代码能力沉淀为 skill，不靠散乱 prompt。
R08 满足：CLI 主路径，GUI 观察状态。
R09 满足：初始四工具足够启动。
R10 满足：coder 从空白 self 长出能力。
R11 满足：self repo 文件表达代码助手自我。
R12 满足：Git 表达 candidate/validated/tag。
R13 满足：失败测试现场保留，agent 用 artifacts 修复。
R14 满足：world 是项目说明书，不是日志。
R15 满足：grow 可长任务，不暴露 session/resume。
R16 满足：状态、进度、产物文件化。
R17 满足：hatch 成 coder 命令。
R18 满足：权限限制命令和文件范围。
R19 不直接适用：不是 feng 自举，但机制一致。
R20 满足：没有 coding 专用 runtime。
```

## 3. Case：API Testing Agent

### 3.1 生命周期推演

```text
new
  feng new apitest 创建 self。
  world/ 描述 OpenAPI、endpoint、auth、schema、响应规则。
  config.schema.yaml 定义 token、base-url、环境名。
  permissions.yaml 限定可访问域名和是否允许写报告。
  interface.yaml 暴露 smoke、case、regression、report。
  evals/ 放 mock API 和错误响应样例。

grow
  用户提供 API spec 和测试目标。
  agent 读取 spec，生成 endpoint index 和测试策略 skill。
  初始 run_command 可执行 curl 或本地测试脚本。
  grow 可新增 http_request、openapi_case_runner、schema_assert 工具。

message list
  provider tools：read/list/run + active HTTP 工具。
  system: kernel contract：不得访问未授权域名，不泄漏 token。
  system: self contract：apitest 身份、spec index、active skills。
  user: state manifest：spec path、endpoint index hash、base-url config ref、报告 artifact path。
  user: latest event：smoke/regression/case 请求。
  tool response：短 HTTP 摘要直接回传；长响应写 artifact。

context / cache
  完整 OpenAPI 不进每轮 prompt。
  稳定 endpoint index 和 auth 规则进入 cache prefix。
  本轮 endpoint schema 片段进入动态后缀。
  响应正文和日志写 artifact。

git / repair
  测试生成策略、工具声明、eval 更新形成 candidate。
  mock API 验证失败时保留请求/响应/断言报告。
  agent 读取失败 artifact 修复 schema_assert 或测试 skill。

check
  self/schema/tool 加载。
  mock API 下能发现故意错误。
  token 不进入日志摘要。
  permissions 阻止未授权域名。

hatch
  hatch 输出 apitest 命令。
  使用者本地配置 token 和 base-url。

execute
  apitest smoke --spec openapi.yaml --base-url ...
  使用者只看报告，不理解 feng。

observability
  artifacts 包含请求摘要、响应摘要、失败断言、报告路径。
  status/watch 展示当前测试进度。
```

### 3.2 R01-R20 覆盖

```text
R01 满足：LLM 生成测试策略和解释失败。
R02 满足：HTTP 请求和文件读取通过 ToolCall。
R03 满足：可自造 http_request/openapi_case_runner。
R04 满足：OpenAPI 和响应正文文件化。
R05 满足：内部协议跨 provider。
R06 满足：system 放权限和安全，user 放 spec refs/latest event，tool response 受控。
R07 满足：API 测试能力沉淀为 skill。
R08 满足：CLI 执行，GUI 观察报告。
R09 满足：初始四工具能启动。
R10 满足：能力由 spec 和示例 grow 出来。
R11 满足：self repo 表达 API agent。
R12 满足：测试策略变更受 Git 管理。
R13 满足：失败请求/响应保留用于修复。
R14 满足：world 是 API 说明书。
R15 满足：regression 可长任务。
R16 满足：报告和失败产物可观察。
R17 满足：hatch 成 apitest。
R18 满足：token/config/permissions 边界清楚。
R19 不直接适用。
R20 满足：HTTP 能力是工具，不是新架构。
```

## 4. Case：汇总新闻 Agent

### 4.1 生命周期推演

```text
new
  feng new newsbrief 创建 self。
  world/ 描述 RSS、网页、来源、时间、引用和事实/观点边界。
  config.schema.yaml 定义订阅源、语言、输出目录。
  permissions.yaml 限定可访问新闻源。
  interface.yaml 暴露 daily、topic、source、format。
  evals/ 放示例文章、重复文章、旧新闻。

grow
  用户提供主题、来源和摘要风格。
  agent 学会去重、聚类、短摘要、引用保留。
  初始 run_command 可读本地 RSS 文件。
  grow 可新增 rss_fetch、web_fetch、article_extract 工具。

message list
  system: kernel contract：不能编造来源，区分事实/推测/观点。
  system: self contract：newsbrief 身份、source index、summary skills。
  optional cached context pack：稳定摘要格式、引用格式。
  user: state manifest：source list path、article artifact refs、topic summary。
  user: latest event：topic/since/limit/format。
  tool response：抓取结果长时只返回 path/hash/摘要。

context / cache
  文章正文不进稳定前缀。
  source index、摘要规则可缓存。
  每轮只放标题、时间、来源、短摘要和引用路径。
  需要事实核对时 read_file 对应 artifact。

git / repair
  摘要规则和去重策略作为 candidate。
  eval 发现旧新闻误报或重复未去掉时保留样例和输出报告。
  agent 修复 skill/eval。

check
  示例文章能去重。
  每条摘要有来源。
  时间范围过滤正确。
  不绕过访问限制。

hatch
  hatch 输出 newsbrief。
  release self 不带用户私有订阅 token。

execute
  newsbrief daily 或 newsbrief --topic AI。
  使用者只看摘要和链接。

observability
  artifacts 存抓取原文、去重报告、摘要输出。
  GUI 可展示抓取进度和产物。
```

### 4.2 R01-R20 覆盖

```text
R01 满足：LLM 摘要、聚类、判断事实/观点。
R02 满足：抓取、读取、写报告通过工具。
R03 满足：可 grow 出 rss_fetch/web_fetch。
R04 满足：网页正文文件化，summary 入 prompt。
R05 满足：provider adapter 不影响 self。
R06 满足：system 放事实边界，tool response 长内容文件化。
R07 满足：摘要/去重/引用是 skills。
R08 满足：CLI 主用，GUI 观察。
R09 满足：初始四工具可从本地源启动。
R10 满足：用户给来源和目标后成长。
R11 满足：self repo 表达新闻 agent。
R12 满足：摘要策略受 Git 管理。
R13 满足：错误摘要样例保留并修复。
R14 满足：world 是新闻源和引用说明，不是文章仓库。
R15 满足：daily 汇总可长任务。
R16 满足：抓取/摘要/失败报告可观察。
R17 满足：hatch 成 newsbrief。
R18 满足：source/config/permissions 区分。
R19 不直接适用。
R20 满足：不引入复杂长期记忆。
```

## 5. Case：小车 Agent

### 5.1 生命周期推演

```text
new
  feng new carbrain 创建 self。
  world/ 描述传感器、电机、速度限制、安全停止条件。
  config.schema.yaml 定义设备地址、校准参数、模拟器配置。
  permissions.yaml 限制高速、持续前进、忽略障碍物等高风险动作。
  interface.yaml 暴露 patrol、stop、calibrate。
  evals/ 放模拟传感器输入和预期动作。

grow
  用户把小车控制方式和感知方式交给 feng。
  agent 学会读取传感器、解释距离、输出安全控制策略。
  初始 run_command 可调用模拟器脚本。
  grow 可新增 sensor_read、motor_control、simulator_step 工具。

message list
  system: kernel contract：安全停止优先，危险动作必须受限。
  system: self contract：carbrain 身份、策略版本、sensor/tool index。
  cached context pack：传感器含义、安全规则。
  user: state manifest：最近传感器 artifact、设备 config ref。
  user: latest event：patrol/stop/calibrate 或最新状态摘要。
  tool response：实时短状态直接回传；长传感器流写 artifact。

context / cache
  安全规则稳定前置，提高缓存和一致性。
  动态传感器状态放后缀。
  原始视频帧/传感器流文件化。
  只把当前决策必要数据放进 prompt。

git / repair
  控制策略作为 candidate。
  模拟 eval 失败时保留输入、输出动作、失败原因。
  从 validated self 启动，读取失败 artifact 修复策略。

check
  模拟输入下能停止/转向。
  失去传感器时安全停止。
  permissions 拦截危险工具调用。

hatch
  hatch 输出 carbrain。
  设备地址和校准参数不进入 self，首次运行配置。

execute
  carbrain patrol --speed low。
  使用者可以 stop/calibrate。

observability
  .feng/events 记录控制决策。
  artifacts 记录模拟失败、安全停止原因、传感器摘要。
  GUI 只读显示 running/progress/artifacts，不直接越权控制。
```

### 5.2 R01-R20 覆盖

```text
R01 满足：LLM 解释状态和策略，但高风险由权限约束。
R02 满足：sensor/motor/simulator 通过 ToolCall。
R03 满足：可 grow 出小车领域工具。
R04 满足：传感器流文件化，当前状态后置。
R05 满足：provider 不影响工具协议。
R06 满足：system 放安全，user 放状态，tool response 控制长度。
R07 满足：避障/校准/安全停止是 skills。
R08 满足：CLI 控制，GUI 观察。
R09 满足：初始四工具可接模拟器启动。
R10 满足：用户给世界和工具后成长。
R11 满足：self repo 表达小车 agent。
R12 满足：策略版本受 Git 管理。
R13 满足：失败策略不吞掉，保留模拟现场修复。
R14 满足：world 是小车说明书。
R15 满足：patrol/grow 是长任务。
R16 满足：运行状态、进度、产物可观察。
R17 满足：hatch 成 carbrain。
R18 满足：config/permissions 对设备和危险动作分界。
R19 不直接适用。
R20 满足：小车只是 world+tools，不是专用 runtime。
```

## 6. Case：Windows 桌面助手 Agent

### 6.1 生命周期推演

```text
new
  feng new deskhelper 创建 self。
  world/ 描述 Windows 文件系统、桌面、下载目录、PowerShell 边界。
  config.schema.yaml 定义授权目录和偏好。
  permissions.yaml 限制读写目录、删除、移动、关闭进程等动作。
  interface.yaml 暴露 organize、find、cleanup、config、dry-run。
  evals/ 放示例目录和预期整理计划。

grow
  用户提供整理规则和示例。
  agent 用 list_files/read_file 理解目录。
  初始 run_command 可执行受限 PowerShell。
  grow 可新增 file_plan、safe_move、windows_search 工具。

message list
  system: kernel contract：默认 dry-run，不访问未授权目录，不删除。
  system: self contract：deskhelper 身份、规则、授权目录 index。
  user: state manifest：目录扫描 artifact、候选操作摘要。
  conversation suffix：保留最近确认或拒绝。
  user: latest event：整理、查找、cleanup 请求。
  tool response：长文件列表写 artifact。

context / cache
  稳定整理规则进入 cache prefix。
  当前目录扫描和用户请求进入 hot suffix。
  完整文件列表和 PowerShell 输出文件化。

git / repair
  整理规则、工具声明、eval 更新形成 candidate。
  eval 失败时保留示例目录计划和错误报告。
  agent 修复规则或权限。

check
  dry-run 不修改文件。
  执行前需要确认。
  不访问未授权目录。
  删除/覆盖被 permission 拦截。

hatch
  hatch 输出 deskhelper。
  用户首次运行配置授权目录。

execute
  deskhelper organize --input ~/Downloads --dry-run。
  使用者不需要理解 self/Git。

observability
  artifacts 展示操作计划、变更摘要、执行结果。
  status/watch/GUI 显示进度和风险。
```

### 6.2 R01-R20 覆盖

```text
R01 满足：LLM 规划整理和解释结果。
R02 满足：文件和命令通过工具调用。
R03 满足：可 grow 出 file_plan/safe_move。
R04 满足：文件列表文件化。
R05 满足：provider adapter 独立。
R06 满足：system 放安全边界，assistant/tool 保留短历史。
R07 满足：整理规则是 skill。
R08 满足：CLI 执行，GUI 观察。
R09 满足：初始四工具足够启动。
R10 满足：从用户规则成长。
R11 满足：self repo 表达桌面助手。
R12 满足：规则版本受 Git 管理。
R13 满足：错误计划保留，agent 修复。
R14 满足：world 是桌面环境说明。
R15 满足：大量整理可长任务。
R16 满足：计划和执行产物可观察。
R17 满足：hatch 成 deskhelper。
R18 满足：授权目录和命令权限明确。
R19 不直接适用。
R20 满足：不做桌面专用复杂系统。
```

## 7. Case：Claude Code 会话管理 Agent

### 7.1 生命周期推演

```text
new
  feng new ccmanage 创建 self。
  world/ 描述项目目录、会话摘要、diff、handoff 文档。
  permissions.yaml 默认只读代码，允许写 handoff。
  interface.yaml 暴露 summarize、handoff、status、next。
  evals/ 放示例会话、Git diff、期望 handoff。

grow
  用户给出会话管理目标。
  agent 学会提取已完成、未完成、阻塞、风险。
  初始 run_command 读取 git status/diff。
  grow 可新增 git_snapshot、session_reader、handoff_writer 工具。

message list
  system: kernel contract：默认不修改业务代码。
  system: self contract：ccmanage 身份、handoff skill index。
  cached context pack：稳定 handoff 格式。
  user: state manifest：diff artifact、会话 artifact、任务摘要。
  user: latest event：summarize/handoff/next。
  tool response：长 diff 和长会话文件化。

context / cache
  handoff 格式和规则稳定前置。
  当前 diff、命令输出、会话日志文件化。
  prompt 放摘要、风险、路径引用。

git / repair
  handoff skill 或格式作为 candidate。
  eval 发现遗漏阻塞点时保留失败样例。
  agent 修复 skill/eval。

check
  示例项目能生成准确 handoff。
  能区分完成/未完成/风险。
  默认不修改业务代码。

hatch
  hatch 输出 ccmanage。

execute
  ccmanage handoff 或 ccmanage summarize。
  使用者只拿到可读 handoff。

observability
  artifacts 包含 handoff 输出、diff refs、遗漏检查。
  status/watch 展示生成进度。
```

### 7.2 R01-R20 覆盖

```text
R01 满足：LLM 总结和提取状态。
R02 满足：Git/文件读取/写 handoff 通过工具。
R03 满足：可 grow 出 session_reader/handoff_writer。
R04 满足：长会话和 diff 文件化。
R05 满足：provider adapter 独立。
R06 满足：system/user/tool 边界明确。
R07 满足：handoff 能力是 skill。
R08 满足：CLI 主路径，GUI 可看 artifacts。
R09 满足：初始四工具足够启动。
R10 满足：从用户目标成长。
R11 满足：self repo 表达会话管理 agent。
R12 满足：skill/eval 受 Git 管理。
R13 满足：遗漏和错误样例保留修复。
R14 满足：world 是会话和项目说明。
R15 满足：长会话整理可长任务。
R16 满足：handoff 产物可观察。
R17 满足：hatch 成 ccmanage。
R18 满足：默认只读业务代码，写 handoff 有边界。
R19 不直接适用。
R20 满足：不需要特殊 Claude Code runtime。
```

## 8. Case：Feng 自举

### 8.1 生命周期推演

```text
new
  自举 case 不创造 fengsmith。
  当前 feng 仓库就是 workspace。
  world/ 描述核心诉求、架构文档、agent expectation、review rounds、源码、测试、Git 历史。
  permissions.yaml 允许读写 docs/specs/源码、运行检查、创建 commit/tag，但不默认 push 或重写历史。
  interface.yaml 对下一版 feng 暴露 new/grow/check/hatch/status/watch/artifacts。
  evals/ 包含架构推演、文档一致性、基础 CLI、自举 hatch 检查。

grow
  用户给新诉求，例如“推演必须按 case 展开”。
  feng 读取 core-requirements、architecture、review-method、agent expectations。
  LLM 根据每个 case 做生命周期推演。
  工具调用读写 docs，运行 rg/git/check。
  grow 可修改 docs、review method、未来源码和 evals。

message list
  provider tools：bootstrap tools + 当前需要的 Git/check helper。
  system: kernel contract：不过拟合、简单、禁止特殊 runtime。
  system: self contract：当前 feng identity、self commit、active review skills。
  cached context pack：R01-R20、review method、架构核心摘要。
  user: state manifest：当前 round 目录、上一轮报告路径、git diff、artifact refs。
  user: latest event：用户最新补充。
  tool response：rg/git/diff 长输出文件化，只留摘要和路径。

context / cache
  R01-R20 和架构核心摘要稳定前置。
  用户新要求、当前 diff、最新 review 结果放后缀。
  历史 round 不全文进入 prompt，按需 read_file。

git / repair
  feng 修改自己的文档或源码形成 candidate。
  check 失败时保留失败报告和 diff。
  validated commit 仍可启动当前 feng。
  agent 读取失败 artifact 和 Git 状态修复自己。
  确认稳定后 tag，并 hatch --name feng --portable。

check
  docs 结构完整。
  R01-R20 覆盖没有回退。
  review-method 被遵守。
  未来实现中还会跑基础 CLI 和 adapter tests。

hatch
  feng hatch --name feng --portable。
  产物仍叫 feng，不是新 agent。

execute
  新 feng 在另一台机器上能 feng new、feng grow、feng check、feng hatch。

observability
  .feng/events 记录每轮成长。
  artifacts 保存推演报告、改进文档、diff、check 结果。
  GUI 只读展示自举进度。
```

### 8.2 R01-R20 覆盖

```text
R01 满足：feng 自举依赖 LLM adapter。
R02 满足：读写文件、运行命令、Git/check helper 通过 ToolCall。
R03 满足：feng 可 grow 出自己的工具和检查器。
R04 满足：历史轮次和 diff 文件化，R01-R20 稳定前置。
R05 满足：自举不绑定 provider。
R06 满足：system 放自举边界，user 放当前状态/latest event，tool response 文件化。
R07 满足：review、spec、implementation 能力都是 skills。
R08 满足：CLI 主路径，GUI 观察自举。
R09 满足：初始四工具能完成文档自举。
R10 满足：feng 自己也从 self repo 成长。
R11 满足：文件即自我是自举前提。
R12 满足：Git 表达 feng 的代际成长。
R13 满足：失败 candidate 由 agent 读取 artifacts 和 Git 修复。
R14 满足：world 是 feng 仓库和架构说明书。
R15 满足：自举 grow 是长任务。
R16 满足：round 目录、events、artifacts 可观察。
R17 满足：hatch 输出下一版 feng。
R18 满足：权限不默认 push/rewrite/delete history。
R19 满足：这是核心自举 case。
R20 满足：没有 fengsmith，没有特殊 runtime。
```

## 9. 汇总结论

按 case 展开后，当前架构仍然成立。

但本轮修正了推演标准：

```text
不能只做整体生命周期推演。
每个 case 都必须单独走完整生命周期。
每个 case 都必须单独检查 R01-R20。
整体结论只能在每个 case 推完之后出现。
```

本轮没有发现新的架构概念缺口。

需要修改的是推演方法文档，而不是 `docs/architecture.md`。
