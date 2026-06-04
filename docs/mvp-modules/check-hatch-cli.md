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

command eval 运行时必须可观测：通过时写 `eval_passed` event；失败时写 `eval_failed` event 和 `eval-output` artifact。失败 artifact 是下一轮 grow 修复 candidate 的材料，不会自动回滚 working tree。

Go source health check 只在 workspace 存在 `go.mod` 时启用。它不是项目专用 eval，也不要求空白 self 预置业务测试；它只防止明显坏掉的 Go runtime/source 被推进成 validated commit。

source health 默认给 `go test ./...` 较宽的运行预算，避免在 Windows、冷缓存或较慢机器上把健康 candidate 误判成失败。预算可以用 `FENG_SOURCE_HEALTH_TIMEOUT_SECONDS` 调整；超时失败仍写 `source-health` artifact，作为下一轮 grow 的恢复材料。

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
install scripts
```

`frozen self` 包含最小 self repo，也包含当前 workspace 中已经长出来、并被 check 管住的可选根：`docs/`、`cmd/`、`internal/`、`pkg/`、`scripts/` 和 Go module 文件。这样 `feng hatch --name feng --portable` 产出的下一代 feng 不会丢失继续自迭代需要的源码、文档和验证材料。

如果 hatch 输出路径位于当前 workspace 内，必须落在 `dist/` 下；workspace 外的显式输出路径可以使用。这样 hatch 可以清理自己的 package 目录，但不能误删 `docs/`、`skills/`、`tools/` 或其他 candidate 内容。

hatch 只能覆盖空目录或已有 feng package 目录；如果目标目录已有普通用户内容且没有 package manifest/marker，必须拒绝覆盖。

hatch 只要求 validated commit 对应的 self roots 干净，不要求整个 workspace 没有无关未跟踪文件。它从 Git 的 `validated_commit` 读取 frozen self 文件，而不是把当前目录完整复制成发布物；被 `.gitignore` 忽略的工作树文件不能进入 package。

hatch manifest 的 `interface` 必须来自 self repo 的 `interface.yaml`，不能由 runtime 硬编码另一套命令说明。默认 feng self 的 interface 是 grow/check/hatch/status/watch/artifacts/gui/tag/config。

`checksums.json` 是 package 的完整性边界。packaged runner 启动时如果发现 package 根目录存在 checksums，就必须校验 frozen self、runner、entrypoint、installer、provider examples 和 manifest 没有缺失、变更或出现未记录文件；校验失败时拒绝运行。没有 checksums 的本地测试 seed/template 不触发 package integrity。

package 根目录是发布物，不是用户 workspace。packaged runner 可以在 package 目录里显示 help，但 `grow` 或 execute 任务不能把 package 根目录或其中的 `self/` 当作 workspace 写入 `.feng`、`.git` 或顶层 self 文件；用户应从目标 workspace 目录运行命名命令。

`hatch --name NAME` 的 NAME 就是用户安装后运行的命令名。runtime 必须显式拒绝非法名字，不能静默 slug 成另一个名字；允许字符只包含字母、数字、dot、dash 和 underscore。NAME 也不能和 package 内部文件或目录冲突，例如 `self`、`install`、`install.ps1`、`provider-examples`、`feng-runner`、`feng-release.yaml`、`checksums.json`，也不能使用 Windows 设备保留名。

产品级 hatch 的 runner 目标是 Go binary。hatch 不引入第二套 runner。

hatch 成功后必须写入 `hatch-preview` artifact，并把它设为 `last_artifacts`；`hatch_created` event 只记录 package path 和 artifact path。这样 `status/watch/gui/artifacts` 都能解释最近一次发布结果。

release package 同时生成命名 entrypoint、固定 runner 和安装脚本：

```text
NAME
NAME.cmd
NAME.ps1
feng-runner
install
install.ps1
```

命名 entrypoint 是轻量 launcher，真实 Go binary 使用固定名字 `feng-runner` / `feng-runner.exe`。这样用户仍然运行 `NAME`，但 Windows 上不会因为 `install/setup/update` 这类命令名触发 installer 提权启发式。安装脚本只在用户指定的 bin 目录生成 launcher，指向当前 package 中的命名 entrypoint。它不移动 frozen self，不写 API key，也不自动修改 PATH。

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
feng config
```

`grow` 是第一个语义入口；bootstrap 是 grow 的前置阶段，不是用户必须理解的独立命令。

`grow --template ./path "..."` 是 bootstrap 的可选 seed，不是新的生命周期命令。template 目录只补缺失的 self 文件，不覆盖已有 workspace 内容。

`grow` 参数解析必须显式失败，而不是静默忽略错误。`--max-turns` 需要整数，未知 `--flag` 需要报错；如果 goal 文本本身以 `--` 开头，用户可以写 `feng grow -- "--开头的目标"`。

`hatch --name NAME` 和 `hatch --out PATH` 的值必须非空；`--name=`、`--out=` 或把下一个 flag 吞成值都必须报错。发布命令不能因为参数缺失静默回到默认输出目录。

`watch --limit N` 只接受正整数 N，未知参数或无效 N 必须报错。可观测命令不能静默回退默认值，否则用户无法判断自己看到的是完整进展还是默认窗口。

`check`、`status` 和 `artifacts` 是无参数命令，传入多余参数必须报错，不能静默忽略。CLI 的每个入口都要让用户明确知道自己运行的到底是什么。

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

单命令 interface 直接执行该命令；多命令 interface 使用第一个参数选择子命令。execute mode 使用 frozen self、本机 provider config、当前目录状态和本次 args 组装 messages，默认不修改 packaged self，也不把 self repo 展开到使用者当前目录。使用者目录只出现 `.feng/` 状态、事件和 artifacts。最终 assistant 输出既打印到 stdout，也写入 `execute-output` artifact，并进入 `last_artifacts`，方便 `status/artifacts/gui` 追踪执行产物。

业务 interface 下，第一个参数默认属于业务命令空间，不能被 feng 内核命令抢占。唯一保留的窄入口是 provider 配置：`config init`、`config status` 和 `config help` 仍由内核处理，方便使用者在不展开 self repo 的情况下完成本机配置。只有默认 feng interface 的 package 才把 `grow`、`check`、`hatch` 等解释为内核 CLI。

## GUI

GUI MVP 只读：

```text
Running
Progress
Artifacts
```

Running 必须包含当前 lock 的 active/stale/owner/pid/heartbeat 视图，和 `feng status` 使用同一套 lock snapshot。GUI 只可视化 `.feng/` 文件，不绕过 CLI、permissions 或 Git 语义；如果显式指定 `--out` 且输出仍在当前 workspace 内，路径必须位于 `.feng/` 下，不能写入 self roots。

`gui --out PATH` 的 PATH 必须是非空路径；空 `--out` 不能静默回退到默认输出。
