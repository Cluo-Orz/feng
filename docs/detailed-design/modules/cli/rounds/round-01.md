# CLI Spec Round 01

## 当前草稿判断

第一版直觉容易把 CLI 写成完整命令手册：

```text
feng init
feng grow
feng hatch
feng run
feng debug
...
```

这会过早进入语法设计，并且容易把命令执行过程包装成 session。

## 顶层视角检测

feng 的用户心智应当简单：

```text
在目录里运行 feng。
grow 推进当前 grow unit。
status 看当前状态。
hatch 从 ready 的 grow unit 产出 package。
run/debug 面向 hatch package。
```

不应该要求用户理解 provider session、terminal session、attempt session 或 debug session。

## 问题

当前草稿缺少：

```text
CLICommandIntent。
CLIExecutionContext。
CLIInvocationReceipt。
CLIOutputEnvelope。
command family 与具体命令语法的分离。
```

如果直接写命令手册，会把详细设计变成 CLI 产品设计，而不是终态事实 spec。

## 调整

引入 command intent 作为解析结果：

```text
command family 只负责派发路径。
raw args 不自动进入 grow。
stdin 不自动成为 admitted material。
CLIExecutionContext 不是 session。
CLIInvocationReceipt 是命令审计，不是业务真相来源。
```

## 进入下一轮的结论

下一轮重点检查 CLI 是否会吞掉各模块的业务职责，变成隐藏的中央控制器。

