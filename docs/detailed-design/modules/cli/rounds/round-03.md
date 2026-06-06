# CLI Spec Round 03

## 当前草稿判断

第三版草稿的模块边界已经成立，但还要检查两个真实使用压力：

```text
长程任务不能靠 CLI 进程内存。
机器可读输出不能绕过 privacy/policy。
```

## 顶层视角检测

feng 的 grow 是长程任务，但 CLI 不应该成为长驻状态容器。

正确边界是：

```text
CLI 可以触发一次 bounded grow attempt。
CLI 退出后，状态仍在 Event Ledger、ArtifactRef、projection、attempt trace 和 module receipts 中。
下一次命令通过 workspace 和 grow unit 打开同一个连续成长空间。
```

同时，hatch 产物不一定是 LLM agent：

```text
CLI 不能把 non_llm_runtime 强塞进 Agent Runtime Kernel。
CLI 不能把 runtime_kernel_unsupported 退化成 prompt wrapper。
```

## 问题

需要补齐：

```text
CLIExecutionContext 不是 session。
CLIInvocationReceipt 不是业务真相来源。
machine_readable 输出也受 privacy 限制。
policy ask 没有 approval 时必须停住。
runtime feedback 必须走 Debug Bridge 和 Admission。
```

## 调整

最终 spec 增加：

```text
用户心智。
Workspace 行为。
Policy Approval Boundary。
错误到 exitStatus 的映射。
验证要求。
```

核心不变量：

```text
command history 不等于 grow memory。
用户输入必须先经过 Admission。
grow message list 只能由 Context & Message Compiler 创建。
runtime message list 只能由 Agent Runtime Kernel 创建。
ready_to_hatch 只能来自 Evidence & Readiness。
```

## 进入下一轮的结论

三轮检测后，该模块可以进入最终 spec。CLI 足够简单，但不会把简单建立在隐藏越权上。

