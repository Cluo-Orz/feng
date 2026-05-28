# MVP 模块：Check, Hatch, CLI and GUI

## Check Runner

check 只回答：

```text
self 能不能加载
schema 能不能解析
interface.yaml 是否声明了非空 commands
tool/permission 是否可用
message compiler 是否可编译
provider profile 是否配置正确
eval 是否能运行
如果 candidate 带 Go runtime/source，`go test ./...` 是否通过
是否存在特殊 runtime 或 secret 泄漏
```

Go source health check 只在 workspace 存在 `go.mod` 时启用。它不是项目专用 eval，也不要求空白 self 预置业务测试；它只防止明显坏掉的 Go runtime/source 被推进成 validated commit。

source health 和 hatch 构建都通过同一套 Go 可执行发现逻辑：优先使用 `FENG_GO_EXECUTABLE`，然后查 PATH，Windows 下再查默认 Go 安装路径。这样 portable feng 在新目录里运行时，不会因为 Go 没写进 PATH 就误判 self 损坏。

secret scan 只覆盖 self/source roots 中的人写内容，跳过依赖目录、构建目录、`.feng/cache` 和 `.feng/runs` 这类生成或运行时内容。

特殊 runtime 检查覆盖 `cmd/`、`internal/` 和 `pkg/` 中的 Go 源码，避免把 feng 自举专用逻辑藏在产品 runner 里。

失败：

```text
不更新 validated_commit
写 check report artifact
写 diff artifact，作为下一轮 grow 的修复材料
state.candidate_status = failed
```

通过：

```text
更新 validated_commit
可创建 checkpoint commit
state.candidate_status = validated
```

checkpoint commit 只纳入 feng self roots，不用 `git add -A` 扫整个 workspace。无关未跟踪目录继续留在原地，既不被提交，也不影响 self 的 validated 语义。

## Hatch Packager

hatch 只能从 validated commit 打包：

```text
frozen self
runner
manifest
checksums
provider examples
named entry command
```

`frozen self` 包含最小 self repo，也包含当前 workspace 中已经长出来、并被 check 管住的可选根：`docs/`、`cmd/`、`internal/`、`pkg/`、`scripts/` 和 Go module 文件。这样 `feng hatch --name feng --portable` 产出的下一代 feng 不会丢失继续自迭代需要的源码、文档和验证材料。

如果 hatch 输出路径位于当前 workspace 内，必须落在 `dist/` 下；workspace 外的显式输出路径可以使用。这样 hatch 可以清理自己的 package 目录，但不能误删 `docs/`、`skills/`、`tools/` 或其他 candidate 内容。

hatch 只能覆盖空目录或已有 feng package 目录；如果目标目录已有普通用户内容且没有 package manifest/marker，必须拒绝覆盖。

hatch 只要求 validated commit 对应的 self roots 干净，不要求整个 workspace 没有无关未跟踪文件。它打包的是 frozen self，不是把当前目录完整复制成发布物。

hatch manifest 的 `interface` 必须来自 self repo 的 `interface.yaml`，不能由 runtime 硬编码另一套命令说明。默认 feng self 的 interface 是 grow/check/hatch/status/watch/artifacts/gui/tag。

产品级 hatch 的 runner 目标是 Go binary。hatch 不引入第二套 runner。

不包含：

```text
API key
本机 provider profile
.feng/runs
.feng/cache
未验证 candidate
```

## CLI

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

`grow` 是第一个语义入口；bootstrap 是 grow 的前置阶段，不是用户必须理解的独立命令。

## Execute Mode

hatch 出来的命名 runner 先读取 packaged `self/interface.yaml`。

如果 interface 仍是默认 feng 命令，runner 保留内核 CLI：

```text
feng grow "..."
feng check
feng hatch --name feng --portable
```

如果 interface 暴露业务命令，runner 进入 execute mode：

```text
xiaogui --input ./Downloads
```

单命令 interface 直接执行该命令；多命令 interface 使用第一个参数选择子命令。execute mode 使用 frozen self、本机 provider config、当前目录状态和本次 args 组装 messages，默认不修改 packaged self。

## GUI

GUI MVP 只读：

```text
Running
Progress
Artifacts
```

GUI 只可视化 `.feng/` 文件，不绕过 CLI、permissions 或 Git 语义。
