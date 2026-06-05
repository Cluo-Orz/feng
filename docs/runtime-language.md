# Runtime 语言策略

## 结论

当前产品级 runtime、CLI、check、hatch 和 portable runner 统一使用 Go 实现。

## 原因

feng 的核心是一个可传播的命令：

```text
feng
xiaopi
coder
newsbrief
```

Go 适合把这些能力收敛为跨平台单命令：

```text
CLI
文件系统
HTTP provider
tool dispatcher
permissions
state/artifact
hatch package
portable runner
```

## 边界

语言选择不能改变产品模型：

```text
feng binary = runtime
.feng = 当前目录 agent 实例
workspace = 用户任务现场
package/self = hatch 后产品稳定能力
.产品名 = 产品在用户目录的运行态
```

MVP 不保留第二套 Python runtime，也不要求使用者理解解释器、虚拟环境或语言包管理。

## 后续

Rust 或其他语言可以作为高风险原生工具、平台 adapter 或性能模块，但不能引入第二套 runtime kernel。

后续只有在模块边界稳定后，才把 `internal/runtime/` 拆成更细包。MVP 先保持简单。
