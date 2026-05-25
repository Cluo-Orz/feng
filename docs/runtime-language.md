# Feng Runtime 语言决策

## 决策

feng 的产品级 runtime 应该使用 Go。

当前 Python 实现是行为原型：它用于验证 MVP loop、文件约定、Git checkpoint、tool 边界、check 和 hatch 语义。迁移 runtime 时，Python 版本应保留为参考实现和测试基准。

## 为什么是 Go

feng runtime 的主要工作是：

```text
CLI
文件系统
Git 进程调用
HTTP LLM adapter
tool dispatch
permission check
state/events/artifacts
portable packaging
```

这些能力更贴合 Go：

```text
容易产出单个命令
跨平台构建简单
标准库足够
分发摩擦小
作为协调型 kernel 性能足够
HTTP 和 subprocess 处理直接
```

Rust 仍然适合未来的高风险原生工具、平台 adapter 或性能敏感组件。但第一版 kernel 的核心诉求是分发简单和架构清晰，Rust 会把复杂度提前。

## 产品约束

hatch 出来的 agent 必须像普通命令：

```text
xiaogui
xiaogui --input ./Downloads
```

使用者不应该理解 Python 环境、虚拟环境、包管理器或源码目录。Go runner 更适合让 `hatch` 产出一个命名可执行文件，并携带或定位 frozen self bundle。

## 迁移规则

runtime 语言不能改变 feng 的架构。

Go runtime 必须保留同一套顶层模型：

```text
Runtime Kernel
Self Repo
.feng State
Git
```

也必须保留第一组命令：

```text
feng grow "..."
feng check
feng hatch --name NAME --portable
feng status
feng watch
feng artifacts
```

只有在 Go 实现保持通用 loop、且不引入项目专用自迭代逻辑时，语言迁移才成立。

## 实现形态

Go runtime 应该保持小：

```text
cmd/feng/
internal/kernel/
internal/selfrepo/
internal/state/
internal/events/
internal/artifacts/
internal/llm/
internal/tools/
internal/permissions/
internal/check/
internal/hatch/
```

MVP 不需要框架。Go 标准库足够。

## Hatch 目标

`hatch --portable` 的产品目标：

```text
dist/xiaogui/
  xiaogui.exe      Windows
  xiaogui          macOS/Linux
  self.feng        frozen self bundle，或嵌入 binary 的 self 数据
  manifest.json
  checksums.json
```

第一个 Go hatch 可以仍然是目录包。后续可以把 `self.feng` append 或 embed 到可执行文件里，但这是打包优化，不是新架构层。

## 当前约束

当前本机没有安装 Go、Rust 或 Cargo，因此不能在这里编译和测试 Go/Rust 代码。安装 Go 工具链之前，影响 runtime 行为的改动应先通过 Python 行为原型验证，并把 Go 迁移要求写清楚，而不能把未编译的 Go 代码当作已验证实现。
