# 第 17 轮推演报告

## 1. 本轮目的

本轮从用户指出的问题重新开始：

```text
MVP 文档预置四个 skill，等于在白板起点里提前塞入 feng 文档能力。
```

这不是一处措辞错误，而是会影响整个架构的方向：

```text
默认模板是否允许藏能力
第一次 grow 是否真的从空白起点开始
skill 是否必须由 grow 长出来
自举是否靠通用逻辑
```

本轮按每个 case 走完整生命周期。

## 2. Coding Agent

### first grow / bootstrap

创造者在目标目录执行 `feng grow "做一个代码助手"`。默认 bootstrap 只创建 self repo 形状、`.feng/`、Git 成长语义和初始工具入口，不预置代码阅读、测试修复或 review skill。

已有源码、测试、构建脚本作为当前 world 的可感知对象，不被覆盖。

### grow

第一次 grow 通过 read/list/run_command 感知项目结构、测试命令和用户目标，生成 candidate：

```text
skills/code-review.md
skills/test-repair.md
world/project-structure.md
evals/fix-simple-test.yaml
interface.yaml
permissions.yaml
```

这些都是 grow 产物，不是模板自带能力。

### message list

稳定前缀只放 kernel contract、self contract、active tool schema。项目文件树、测试失败、diff、用户目标在动态后缀或 artifact refs。

### tool growth

初始工具只负责读写文件、列目录、运行受限命令。后续可 grow 出更高层的 test helper，但必须进入 tools/ 并通过 check。

### context / cache

长测试日志和 diff 文件化。稳定 skill/world index 进入缓存前缀，最近失败原因进入 hot suffix。

### git / repair

失败 candidate 不丢弃。agent 读取 diff/check report，继续编辑 working tree。commit/tag 由 kernel 在 check/hatch 通过后推进。

### check

验证 self 能加载、permissions 限制命令、示例测试修复 eval 能通过。

### hatch

validated self hatch 成 `coder`。使用者只运行 `coder review` 或 `coder "修复测试"`。

### execute / observability

execute mode 运行 frozen self，不修改 packaged self。运行状态、测试日志、diff、artifact 通过命令和 GUI 只读查看。

## 3. API Testing Agent

### first grow / bootstrap

默认 self 不预置 API 测试能力。创造者给目标、OpenAPI 路径、base URL 规则。

### grow

grow 读取 spec 示例和用户说明，生成 API 相关 world、HTTP tool 声明、schema check skill、mock eval、permissions。

### message list

完整 OpenAPI 不直接进 prompt。只放 spec artifact ref、当前 endpoint、失败 response 摘要和必要片段。

### tool growth

HTTP 请求工具是领域工具，由 grow 创建并受 permissions 限制域名。

### context / cache

schema 摘要、稳定 endpoint index 可缓存；响应日志和失败报告文件化。

### git / repair

schema mismatch 报告作为 artifact，下一轮 grow 修复测试规则或工具实现。

### check

运行 mock API eval，验证不访问未授权域名、不泄漏 token、报告可复现。

### hatch

hatch 成 `apitest`，manifest 声明网络权限和 config schema。

### execute / observability

使用者运行 `apitest smoke --spec ...`。报告、请求摘要、失败原因作为 artifacts 可观察。

## 4. 汇总新闻 Agent

### first grow / bootstrap

默认 self 不预置新闻抓取、去重或摘要 skill。创造者给来源、主题和摘要标准。

### grow

grow 生成新闻源 world、去重 skill、引用格式 eval、source permissions 和 interface。

### message list

网页正文、RSS 内容、搜索结果写入 artifacts。message 只保留来源、时间、hash、摘要和 why_relevant。

### tool growth

抓取工具是领域工具，必须声明可访问来源和速率边界。

### context / cache

稳定主题规则和引用标准可缓存；当天文章列表和去重结果在动态后缀。

### git / repair

摘要误判或时间过滤失败保留 candidate 和 fixture，下一轮修复 skill/eval。

### check

fixture 文章验证去重、时间过滤、引用来源和事实/观点区分。

### hatch

hatch 成 `newsbrief`，配置本地订阅源和 API key，不打包用户 secret。

### execute / observability

使用者运行 `newsbrief daily`。抓取日志、dedupe report、summary draft 进入 artifacts。

## 5. 小车 Agent

### first grow / bootstrap

默认 self 不预置小车控制能力。创造者描述传感器、控制接口和安全目标。

### grow

grow 生成传感器 world、控制 tool 声明、安全停止 skill、模拟 eval、permissions。

### message list

sensor log、camera frame、control report 文件化。message 中只放摘要和关键片段。

### tool growth

传感器读取和电机控制工具必须由 grow 写入 tools/，并通过权限和模拟器 check。

### context / cache

稳定硬件说明和安全规则可缓存；实时传感器结果是动态后缀。

### git / repair

模拟失败或安全 eval 失败保留 candidate，agent 修复控制规则。不能强制回滚掩盖失败。

### check

检查失去传感器输入时安全停止、高风险动作被拒绝、模拟场景通过。

### hatch

hatch 成 `carbrain`，manifest 声明硬件权限、平台要求和 config schema。

### execute / observability

使用者运行 `carbrain patrol --speed low`。running/progress/control artifacts 可观察。

## 6. Windows 桌面助手 Agent

### first grow / bootstrap

默认 self 不预置桌面整理能力。创造者给授权目录、分类规则、dry-run 要求。

### grow

grow 生成文件整理 skill、PowerShell 权限、dry-run eval、interface 和 world。

### message list

目录树和 PowerShell 输出文件化。message 只放计划摘要、路径、hash、关键片段。

### tool growth

高层文件操作工具可以由 grow 创建，但必须保留 dry-run 和 permission check。

### context / cache

用户偏好和分类规则可缓存；本次目录列表和操作计划在动态后缀。

### git / repair

失败计划作为 artifact，下一轮修复规则。实际执行前必须确认。

### check

验证 dry-run 不改文件、未授权目录被拒绝、危险命令失败。

### hatch

hatch 成 `deskhelper`，config schema 引导授权目录。

### execute / observability

使用者运行 `deskhelper cleanup --dry-run`，通过 artifacts 查看计划和结果。

## 7. Claude Code 会话管理 Agent

### first grow / bootstrap

默认 self 不预置 Claude Code 会话结构。创造者给会话目录、handoff 目标和只读边界。

### grow

grow 生成会话读取 world、handoff skill、Git diff skill、默认只读 permissions、fixture eval。

### message list

长会话日志、diff、命令输出写 artifacts。message 只保留摘要和引用。

### tool growth

可以 grow 出 handoff writer，但默认不修改业务代码。

### context / cache

handoff 格式和项目约定可缓存；当前会话状态在 hot suffix。

### git / repair

错误 handoff 作为 candidate 继续修复，validated commit 不被污染。

### check

fixture 验证已完成/未完成/风险提取准确，默认不写业务代码。

### hatch

hatch 成 `ccmanage`。

### execute / observability

使用者运行 `ccmanage handoff`，生成 handoff artifact 和输出文件。

## 8. Feng 自举

### first grow / bootstrap

当前 feng 仓库执行 `feng grow "改进 feng 自己"`。默认模板不能预置读取需求、架构 review、编辑 self、修复 candidate 这些 skill。它只能补齐空白 self 形状。

### grow

grow 通过初始工具读取 docs、review 轮次、Git 状态和用户目标，然后生成 candidate skills/world/evals。比如“架构 review 是否 case-first”应由 grow 根据当前目标沉淀为 eval，而不是模板提前写好。

### message list

核心诉求、架构文档、MVP 文档按 artifact refs 和必要片段进入 context。稳定前缀不能被每轮动态 review 内容污染。

### tool growth

初始四工具足够完成文档自举。后续可 grow 出 doc checker，但必须进入 tools/ 并通过 check。

### context / cache

长文档、diff、review 报告文件化。self summary、active tool schema、稳定 world index 可缓存。

### git / repair

LLM 读取 Git report、diff、check artifacts 修复 working tree。kernel 在 check 通过后推进 validated commit。

### check

验证 self 健康、schema、permissions、provider 边界、secret 边界，以及由 grow 生成的当前项目 eval。不能有专用自举 runtime 或项目名分支。

### hatch

`feng hatch --name feng --portable` 从 validated commit 打包下一版 feng。

### execute / observability

新 feng 在另一个目录继续 grow/check/hatch。events、artifacts、status 可观察。

## 9. 结构性发现

```text
1. 默认 bootstrap 不能预置任何项目 skill。
2. MVP 自举需要的 review/edit/repair 能力必须由 grow 生成 candidate。
3. architecture 文档需要明确没有 skill 时的通用 seed loop。
4. local template 可以带能力，但这是创造者显式选择，不是 feng 默认能力。
```

这些修改同时影响所有 case，因此不是 workaround。
