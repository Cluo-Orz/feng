# Claude Code 借鉴 Review 第 1 轮：架构 Case 推演

本轮只按当前 `core-requirements.md`、`architecture.md`、`mvp-self-iteration-design.md` 和 `llm-provider-research.md` 描述的终态推演，不预设还没写进文档的能力。

## 1. Coding Agent

创造者执行 `feng grow "做一个代码助手"`。非 workspace 时，grow 先 bootstrap 最小 self repo、`.feng/` 和 Git。默认 `skills/` 为空，seed loop 用 read/write/list/run_command 感知项目文件、测试脚本和 Git 状态，然后生成 candidate skill、world、eval、interface 和 permissions。

message list 中，kernel contract、self contract、active tool schema、skill/world index 进入稳定前缀；本次测试失败、diff、日志摘要进入动态后缀。长测试输出进入 `.feng/artifacts/`，message 中只保留路径、hash、摘要和关键片段。

check 验证 self schema、tool/permission、baseline eval，以及 grow 生成的代码项目 eval。失败时不回滚 candidate，保留 diff/check report，让下一轮 grow 修复 working tree。通过后更新 validated commit，hatch 成 `coder`。

当前满足：白板起点、Git candidate、artifact refs、permission boundary、命名命令。

当前不足：文档没有明确 LLM/provider 错误恢复，长测试或 provider 429/529 时如何延续 grow 还不够具体；skill 两级加载还停留在概念描述，没有模块级 contract。

## 2. API Testing Agent

创造者执行 `feng grow "做一个 API 测试命令"`，seed loop 读取 OpenAPI 示例、用户目标、现有测试数据，生成 API world、HTTP tool 声明、权限边界、接口参数和 mock eval。

config 保存 token/base URL 等本机事实；world 保存 API schema、术语和稳定约束；args 表达本次运行参数。hatch 产物不包含密钥，只包含 config.schema 和 provider/tool requirement。

当前满足：world/config/args 边界清楚，permissions 能限制域名和 token，hatch 不泄漏 secret。

当前不足：active tool pack 变动和 cache key 的关系没有在架构中显式约束。grow 出 HTTP tool 后，下一轮必须刷新 tool schema hash，否则 message compiler 可能错误复用旧工具前缀。

## 3. News Summary Agent

创造者执行 `feng grow "做一个新闻汇总命令"`。seed loop 根据用户提供的源、主题、引用要求生成 news world、抓取/读取工具、去重摘要 skill、引用 eval、permissions 和 interface。

网页正文、RSS 原文、搜索结果进入 artifacts；message 只放来源、时间、hash、短摘要、为什么相关和必要片段。稳定摘要规则、引用格式、主题偏好进入 skill/world index。

当前满足：大内容文件化和稳定/动态分层适合新闻场景。

当前不足：LLM message 编排要求已经写出，但“超长后恢复策略”在 MVP 中只有 artifact refs，没有明确 reactive compact、低相关 skill 出局、仍超长时 blocked 的状态落点。

## 4. Robot Car Agent

创造者执行 `feng grow "做一个小车 agent"`，把传感器和控制接口说明作为目标/文件提供给 feng。seed loop 生成小车 world、控制 tool 声明、安全停止 skill、模拟 eval 和 permissions。

运行时实时传感器数据是动态后缀或 artifact；稳定硬件说明和安全规则是 world/skill。权限边界限制高速、持续前进、忽略障碍物等高风险动作。

当前满足：world 是说明书，config/args 是本机和单次事实，tool call 受 permission 边界。

当前不足：长任务控制消息没有结构化 request_id/事件语义，例如安全确认、缺失配置、停止请求目前只靠普通 message 表达，未来可能不可观测。

## 5. Windows Desktop Assistant

创造者执行 `feng grow "帮我整理桌面"`，seed loop 读取示例目录和用户规则，生成文件整理 skill、PowerShell 工具/权限、dry-run eval、interface 和 config schema。

使用者运行 `deskhelper organize --input ~/Downloads --dry-run`。execute mode 默认读取 frozen self、本机 config 和 args，不修改 packaged self。dry-run 结果进入 artifact，实际执行前走 permission check。

当前满足：使用者不需要理解 feng；permissions 是执行边界；GUI 只是状态/产物可视化。

当前不足：run_command 的长命令生命周期只说“运行受限命令”，没有说慢命令、后台命令、命令输出增长和 artifact 之间的最小关系。

## 6. Claude Code Session Manager

创造者执行 `feng grow "做一个 Claude Code 会话管理命令"`，seed loop 生成会话读取 world、handoff skill、Git diff skill、只读 permissions 和 fixture eval。

长会话日志、diff、命令输出进入 artifacts；message 只带摘要和引用。hatch 成 `ccmanage` 后默认只读，不修改业务代码。

当前满足：artifact refs 和 permissions 能覆盖会话管理场景。

当前不足：memory/session summary 与 artifact 的边界在核心诉求中有，但架构文档里没有明确“运行证据不等于稳定经验”的模块落点。

## 7. Feng 自举

当前 feng 仓库执行：

```text
feng grow "让 feng 更好地校准自己的架构、代码和验证方式"
feng check
feng hatch --name feng --portable
```

默认 template 只补齐 self 形状，不预置 feng 专用 skill。seed loop 读取核心诉求、架构、MVP、LLM 文档、目标 agent 样本、Git 状态和历史 review artifacts。LLM 生成 candidate skills/evals/world/interface 或文档/源码修改。

check 验证 self 能加载、message compiler 能编译、permissions 不越界、无真实 key、无自举专用 runtime、candidate 项目 eval 能运行。失败时保留 check report 和 diff，下一轮 grow 继续修复。通过后 kernel 更新 validated commit 并可 hatch 下一版 `feng`。

当前满足：自举不需要特殊命令；四个 skill 不再预置；失败 candidate 不强制回滚。

当前不足：

1. 自迭代必须依赖通用逻辑，但 MVP 主文档还没有把模块级 contract 写清楚，代码实现时容易把“读 feng 文档、review 架构、修复 candidate”重新硬编码进去。
2. grow 是长任务，但 LLM 错误恢复、context pressure、控制事件和预算结束如何落到 `.feng/state.yaml` 还不够具体。
3. Claude Code 的两级 skill 加载、context compact、active tool pack/cache 经验还没有被 native 化到模块设计。

## 本轮结论

当前主架构方向正确：没有预置项目 skill，保持单 loop，使用 self repo + `.feng` + Git 表达成长。

但它还不是足够可实施的 MVP 设计。缺口集中在四处：

```text
长任务恢复
skill/context 编译细节
active tool pack/cache 边界
模块级设计文档
```

这些不是新系统，也不是给某个 case 打补丁。它们是让单 loop 能长期运行、能自迭代、能保持 token efficiency 的 kernel 基础能力。
