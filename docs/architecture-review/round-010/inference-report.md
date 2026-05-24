# 第 10 轮推演报告

## 1. 本轮目的

本轮使用 `docs/architecture-review/review-method.md` 重新审查 `docs/architecture.md`。

目标不是再写一遍 case 生命周期，而是检查：

```text
R01-R20 是否在 architecture.md 中表达清楚
哪些点只是 core-requirements.md 清楚，但 architecture.md 容易误解
哪些点需要小修术语，哪些不该进入架构概念文档
```

## 2. R01-R20 表达清晰度审计

| 编号 | 架构表达 | 判断 | 说明 |
| --- | --- | --- | --- |
| R01 | Runtime Kernel 负责 LLM adapter | 清楚 | 不需要写 provider 细节。 |
| R02 | Loop 中有 llm -> hook -> call tool -> hook | 清楚 | Tool / ToolCall 在 LLM 和缓存章节出现。 |
| R03 | grow 可修改 tools/，check 验证 tool | 清楚 | 自造工具不需要独立平台。 |
| R04 | token efficiency、stable prefix、artifact refs | 清楚 | 第 7 轮后表达充分。 |
| R05 | OpenAI / Anthropic 是 adapter 差异 | 清楚 | 不泄漏到 self 核心概念。 |
| R06 | provider tools/system/user/assistant/tool response 边界 | 清楚 | 已明确 assistant 不保存长推理，tool response 长结果文件化。 |
| R07 | skill 是成长单位，hook 是介入时机 | 清楚 | 架构主线稳定。 |
| R08 | CLI 主路径，GUI 只读状态视图 | 清楚 | 不需要 GUI 细节。 |
| R09 | 四个 bootstrap tools | 清楚 | 已明确列出。 |
| R10 | new/grow/check/hatch | 清楚 | 产品路径明确。 |
| R11 | Self Repo 文件清单 | 清楚 | 已列出主要文件。 |
| R12 | validated commit / candidate / tag | 清楚 | Git 作为成长介质明确。 |
| R13 | candidate 失败后修复 | 基本清楚，已小修 | 补充失败报告、diff、验证结果进入 artifacts，并通过 artifact refs 回到上下文。 |
| R14 | world/config/args/artifacts 区分 | 清楚 | world 不是日志。 |
| R15 | grow 长任务但无 resume | 清楚 | Workspace State 章节明确。 |
| R16 | .feng state/events/artifacts/status/watch | 清楚 | GUI 是只读可视化。 |
| R17 | hatch 输出 named command | 基本清楚，已小修 | 残留 release 主语义已改成 hatch 或 hatch package。 |
| R18 | config 和 permissions | 清楚 | config.schema.yaml 和 permission check 都出现。 |
| R19 | feng hatch --name feng --portable | 清楚 | 自举不引入特殊 runtime。 |
| R20 | 四核心对象，MVP 不做复杂系统 | 清楚 | 简单性边界稳定。 |

## 3. 本轮发现的问题

### 3.1 release 术语残留

问题：

```text
architecture.md 中少量位置仍用 release 表示用户可见主语义。
```

这会与当前产品路径冲突：

```text
grow -> check -> hatch
```

修正：

```text
release 后暴露参数 -> hatch 后暴露参数
world 可随 release 传播 -> world 可随 hatch package 传播
release 预览 -> hatch 预览
release 是命名可执行产物 -> hatch 是命名可执行产物
```

保留：

```text
release package
```

因为它是 hatch 产出的技术包，不是用户主命令。

### 3.2 Repair 机制表达略短

问题：

```text
architecture.md 写了 candidate 失败后继续修复，但没有直接说明失败现场如何回到下一轮上下文。
```

修正：

```text
失败报告、diff 和验证结果写入 .feng/artifacts/，下一轮通过 artifact refs 进入上下文。
```

这让 R13 和 R04 连接起来：

```text
修复需要证据
证据不能每轮全文塞入 prompt
所以用 artifact refs 回到上下文
```

## 4. 不需要修改的点

本轮不建议补这些实现细节：

```text
Provider adapter JSON 字段
cache_control 的具体写法
token 预算比例
artifact 文件命名规则
GUI 页面设计
Git helper 的具体命令
package 格式细节
```

这些进入最小实现规格。

## 5. 客观结论

按 R01-R20 审计后，当前架构没有新的概念缺口。

本轮只做术语一致性和 repair 表达补强：

```text
R13 更清楚
R17 更清楚
R20 不受影响
```
