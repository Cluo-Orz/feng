# Feng Runtime 语言决策

## 决策

feng 的 runtime、CLI、check、hatch 和 portable runner 统一使用 Go 实现。MVP 不保留第二套运行时，也不要求使用者理解解释器、虚拟环境或语言包管理。

## 为什么是 Go

feng runtime 的主要工作是协调：

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

使用者只需要拿到命名可执行文件和必要配置。portable package 可以携带 frozen self bundle，但 runner 本身仍是 Go binary。

## 架构不变量

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
feng gui
feng tag NAME
```

只有在 Go 实现保持通用 loop、且不引入项目专用自迭代逻辑时，语言选择才成立。

## 实现形态

Go runtime 保持小而直接：

```text
cmd/feng/
internal/runtime/
```

后续只有在模块边界真的稳定时，才把 `internal/runtime/` 拆成更细的包。MVP 不需要框架。

## Hatch 目标

`hatch --portable` 的产品目标：

```text
dist/xiaogui/
  xiaogui.exe      Windows
  xiaogui          macOS/Linux
  self/            frozen self bundle
  feng-release.yaml
  checksums.json
```

第一个 hatch 可以是目录包。后续可以把 self bundle embed 到可执行文件里，但这是打包优化，不是新架构层。

## 当前验证

影响 runtime 行为的改动必须至少通过：

```text
go test ./...
go vet ./...
go build ./cmd/feng
真实二进制 smoke
portable hatch smoke
```

如果涉及 provider，还必须用临时环境变量验证真实 provider 调用，并确认 API key 没有写入仓库、artifact 或 hatch package。
