# Runtime Contract Registry Spec Round 01

## 当前草稿判断

第一版草稿容易把 Runtime Contract 写成普通 API schema：

```text
输入 JSON schema。
输出 JSON schema。
版本号。
```

这个草稿过窄。feng 的 hatch 产物不是普通接口函数，它要进入目标世界运行，并且必须能被观察、调试、反馈和升级。

## 顶层视角检测

产品概念要求 hatch 产物是可复制运行单元，而不是复制 prompt、记忆或 grow 目录。可复制依赖运行契约：

```text
谁调用它。
它接收什么状态或材料。
它输出什么结果、事件或动作。
它能影响哪些外部资源。
它如何失败。
如何打开调试模式。
如何记录 trace。
如何形成反馈候选。
版本如何兼容或破坏兼容。
```

如果 contract 只写输入输出 schema，boss、小车、小说、音乐这些目标世界都会丢掉关键运行边界。

## 问题

```text
缺少 runtime kernel type，无法表达非 LLM、标准 agent、自定义 agent 和混合 runtime。
缺少 action boundary，无法声明目标世界动作和权限。
缺少 debug contract，hatch 产物无法参与后续 grow。
缺少 feedback contract，多层回流无法归因。
缺少 failure contract，宿主无法稳定处理失败。
缺少 version compatibility，发布后无法升级或回滚。
```

## 调整

将模块定位调整为：

```text
hatch 产物运行契约的 registry、版本、验证和锁定层。
```

补入以下 contract 组成：

```text
InputContract
OutputContract
EventContract
ActionBoundaryContract
RuntimeKernelBinding
DebugContract
FeedbackContract
FailureContract
ObservabilityContract
VersionCompatibility
```

## 进入下一轮的结论

Runtime Contract 不能只是 API schema。下一轮要检查它是否走向另一个误区：把所有 hatch 产物都塞进一个 agent 模板。

