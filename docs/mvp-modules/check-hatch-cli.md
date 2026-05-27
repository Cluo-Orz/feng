# MVP 模块：Check, Hatch, CLI and GUI

## Check Runner

check 只回答：

```text
self 能不能加载
schema 能不能解析
tool/permission 是否可用
message compiler 是否可编译
provider profile 是否配置正确
eval 是否能运行
如果 candidate 带 Go runtime/source，`go test ./...` 是否通过
是否存在特殊 runtime 或 secret 泄漏
```

Go source health check 只在 workspace 存在 `go.mod` 时启用。它不是项目专用 eval，也不要求空白 self 预置业务测试；它只防止明显坏掉的 Go runtime/source 被推进成 validated commit。

失败：

```text
不更新 validated_commit
写 check report artifact
state.candidate_status = failed
```

通过：

```text
更新 validated_commit
可创建 checkpoint commit
state.candidate_status = validated
```

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

如果 hatch 输出路径位于当前 workspace 内，必须落在 `dist/` 下；workspace 外的显式输出路径可以使用。这样 hatch 可以清理自己的 package 目录，但不能误删 `docs/`、`skills/`、`tools/` 或其他 candidate 内容。

产品级 hatch 的 runner 目标是 Go binary。Python runner 只作为当前行为原型存在，不能成为长期使用者体验的前提。

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
```

`grow` 是第一个语义入口；bootstrap 是 grow 的前置阶段，不是用户必须理解的独立命令。

## GUI

GUI MVP 只读：

```text
Running
Progress
Artifacts
```

GUI 只可视化 `.feng/` 文件，不绕过 CLI、permissions 或 Git 语义。
