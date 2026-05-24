# 第 15 轮推演报告

## 1. 本轮目的

第 14 轮收敛了起点语义。本轮继续从全局看两个问题：

```text
grow mode 和 execute mode 是否混在一起
skill 作为成长单位是否足够明确
```

这两个问题如果不收敛，后续容易长出三个复杂系统：

```text
一套给成长用的 agent runtime
一套给执行用的 app runtime
一套绕过 tool/permission/check 的 prompt 或 hook 插件系统
```

## 2. Case 推演摘要

### Coding Agent

`coder` 的创造者在 grow mode 中孵化代码能力，允许修改 self repo、skills、tools、evals。使用者运行 `coder review` 时处于 execute mode，只按 `interface.yaml` 操作目标项目，不需要理解 self repo。

需要 skill 最小形态，否则“代码审查能力”会退化为一段 prompt。合理 skill 应描述 when、goal、context、tools、output、checks。

### API Testing Agent

grow mode 中新增 HTTP tool、schema mismatch skill、mock eval。execute mode 中 `apitest smoke` 只读取 spec/config/args，输出 report。

API skill 如果缺少 tools/checks 字段，就无法表达“只访问授权 base URL”和“schema eval 必须通过”。

### 汇总新闻 Agent

grow mode 中沉淀去重、时间过滤、引用规则和新闻源 world。execute mode 中 `newsbrief daily` 不修改 frozen self，只读取 source config 并输出摘要。

新闻 skill 需要 context/artifact 约束，避免把所有文章正文塞进 message。

### 小车 Agent

grow mode 中定义传感器 world、控制 tool、安全 eval。execute mode 中 `carbrain patrol` 只运行 validated/frozen self，并受 permissions 控制。

小车 case 说明 hook 未来可以触发脚本，但脚本必须是 tool，不能绕过 permission/check。

### Windows 桌面助手 Agent

grow mode 中建立文件整理 skill、dry-run eval、PowerShell 权限。execute mode 中 `deskhelper cleanup --dry-run` 只按业务 interface 运行。

skill 必须写清 output/checks，否则 dry-run 和真实执行边界会混淆。

### Claude Code 会话管理 Agent

grow mode 中沉淀 handoff skill 和只读权限。execute mode 中 `ccmanage handoff` 生成文档，不默认修改业务代码。

skill 的 tools 字段帮助 active tool pack 保持小，避免每轮暴露所有工具。

### Feng 自举

feng 自举的特殊性只在名字：hatch 产物仍叫 `feng`。它不能因此获得特殊 runtime。被 hatch 出来的 `feng` 在另一台机器上继续暴露 grow/check/hatch，是因为它的 interface 本来就是孵化器接口。

这说明 MVP 文档需要把 `feng` 的 execute interface 和普通 agent 的 execute interface 区分清楚。

## 3. 覆盖状态

```text
R01-R06  满足。message compiler 仍是唯一组装点。
R07      部分满足后已修正。skill 需要最小能力契约，不能只是 prompt 文本。
R08-R13  满足。
R14      满足。world 是 context 来源之一，不是运行日志。
R15      满足。grow mode 是长任务，execute mode 是命名命令执行。
R16-R18  满足。
R19      部分满足后已修正。feng hatch 后仍叫 feng，不代表创建了专用 agent。
R20      满足。两个 mode 共享内核，未新增系统。
```

## 4. 结构性发现

本轮发现两个需要写进主文档的概念：

```text
grow mode / execute mode
skill 最小能力契约
```

它们不是实现细节。前者保证产品语义清楚，后者保证 context engineering 不退回 prompt 拼接。
