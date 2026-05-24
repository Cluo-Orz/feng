# MVP Review 第 5 轮推演报告

## 1. 本轮目的

本轮专门检查 MVP 设计是否真正能用通用逻辑自迭代，而不是靠隐藏的 feng 特例。

重点：

```text
第一次 grow bootstrap 是否足够
LLM/tool call 是否能修复 self
Git promote/tag 是否有明确边界
provider/config 是否进入错误位置
MVP 是否仍保持简单
```

## 2. 自迭代生命周期推演

### 2.1 第一次 grow

开发者在 feng 仓库执行：

```text
feng grow "根据核心诉求改进 MVP 自迭代设计"
```

如果当前目录还不是 workspace，grow 只补齐缺失 self 文件、`.feng/` 和 Git 成长状态，不覆盖已有 docs、review 轮次、源码、测试和脚本。

provider profile 如果缺失，状态进入 `missing_config`。profile 可以来自用户级配置、显式路径或 `.feng/` 下未跟踪配置，不能进入 self repo。

### 2.2 LLM 和工具

kernel 读取 self repo、核心诉求、架构文档、MVP 文档、review 轮次、Git 状态。message compiler 只把稳定契约、self index、active tool schema 和 artifact refs 放进 messages。

LLM 通过 tool call 读取/写入文档，运行受限检查。长 diff、搜索结果、失败报告进入 `.feng/artifacts/`。

### 2.3 Git 修复

LLM 可以感知 Git：

```text
读取 state/artifacts
运行允许的 git status/diff/log
根据失败报告继续编辑 working tree
```

但 LLM 不应通过普通 tool call 任意推进版本。validated commit、checkpoint commit 和 hatch tag 应由 kernel 在 check/hatch 通过后执行。

### 2.4 Check

`feng check` 验证：

```text
self repo 能加载
message compiler 能编译
permissions 生效
provider profile 不含真实 key
没有 fengsmith / if project == feng
review 方法仍 case-first
```

失败时保留 candidate 和 artifacts，不强制回滚。

### 2.5 Hatch

`feng hatch --name feng --portable` 只能从 validated commit 打包。产物包含 frozen self、runner、manifest、provider example 和 checksums，不包含 API key、本机 cache、失败 candidate。

因为 hatch 出来的命令名仍是 `feng`，所以它在另一台机器上继续暴露 grow/check/hatch。这不是自举特例，而是 interface 的结果。

## 3. 发现的问题

```text
1. MVP 文档有一个错字：未来源码。
2. Git 推进权需要明确：LLM 修复 working tree，kernel 在验证通过后 commit/tag。
3. provider profile 的位置需要明确：本机配置，不是 self repo。
```

## 4. 覆盖状态

```text
G01 通用性        满足。
G02 自迭代闭环    满足，第一次 grow bootstrap 已成为起点。
G03 文件即自我    满足。
G04 LLM 和工具    满足。
G05 Token efficiency 满足。
G06 Git 成长      部分满足后已修正：commit/tag 归 kernel 验证动作。
G07 Check         满足。
G08 Hatch         满足。
G09 可观测性      满足。
G10 简单性        满足。
```
