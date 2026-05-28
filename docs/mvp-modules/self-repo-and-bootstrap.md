# MVP 模块：Self Repo and Bootstrap

## 职责

Self Repo 是 agent 的文件化自我。Bootstrap 只补齐最小形状，不提供隐藏能力。

## 最小文件

```text
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
```

## Bootstrap 行为

如果当前目录不是 feng workspace，`feng grow "..."` 执行：

```text
创建缺失的 self 文件
创建 .feng/
初始化 Git 成长语义
写入初始 state
记录 bootstrap event
```

已有源码、文档、测试和配置不被复制或覆盖。它们是当前 workspace 的可感知世界。

`feng grow --template ./path "..."` 可以显式指定本地 template。template 只是 bootstrap seed：它只能补齐缺失的 self 文件、skills/tools/world/evals 和可选源码 roots，不能覆盖当前 workspace 已有文件。`--template builtin` 或 `--template default` 等同于内置最小形状。

如果 `grow` 来自 hatch package，bootstrap 还会从 packaged `self/` 复制可选 roots，例如 `docs/`、`cmd/`、`internal/`、`pkg/`、`scripts/` 和 Go module 文件。复制规则仍然是不覆盖已有文件；这保证下一代 feng 在新目录里不只拥有最小 self，也拥有继续自迭代所需的源码、文档和验证材料。

来自 hatch package 的 bootstrap 会把 manifest 里的 `self_commit` 写入 `.feng/state.yaml` 的 `source_self_commit`。这个字段用于观测和追踪代际来源，不会伪装成本地 Git 已验证 commit。

## Skill 起点

```text
skills/ 可以为空。
默认 template 不预置项目 skill。
第一个 grow 通过 seed loop 生成 candidate skill/world/eval/interface。
```

## 不变量

```text
template 是形状，不是能力包。
self repo 不存 API key。
稳定经验必须经过 grow/check 才写入 self repo。
运行日志留在 .feng/，不写进 world/。
```
