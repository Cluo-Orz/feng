# Runtime Contract Registry Spec Round 03

## 当前草稿判断

第三版草稿还要防止 Runtime Contract 变成 hatch package 本身，或变成 runtime implementation。

需要区分：

```text
contract：承诺如何运行。
hatch package：实际可复制交付物。
runtime kernel：运行时执行底座。
target world adapter：目标世界接入层。
debug feedback bridge：反馈回流层。
```

## 顶层视角检测

可复制能力包必须有 contract，但 contract 不等于能力包。contract 也不应该直接上报反馈或执行动作。

在多层循环中，contract 的作用是让每层知道：

```text
如何调用。
如何观察。
如何调试。
如何失败。
如何生成反馈候选。
哪些版本兼容。
```

反馈是否上报、上游是否吸收，仍然由 Admission、Feedback Bridge 和对应 grow 层处理。

## 问题

```text
如果 contract 直接包含本机 secret 或 grow 噪声，会污染 hatch。
如果 contract 可原地修改，发布后的 runtime 不可复现。
如果 contract valid 就直接 hatch，会绕过 Evidence 和 Hatch Builder。
如果 contract 直接发送 feedback，会绕过 Debug & Feedback Bridge 和 Admission。
```

## 调整

固定以下终态规则：

```text
runtime_contract artifact 由 Runtime Contract Registry 创建。
contract version 不可原地修改。
lock_for_hatch 后只能通过新版本替换。
contract valid 不等于 ready_to_hatch。
ready_to_hatch 不等于 contract packaged。
contract 只声明 feedback entry，不直接上报反馈。
contract 不包含 secret 原文。
```

## 进入下一轮的结论

Runtime Contract Registry spec 可以收敛。它负责 contract 的登记、版本、完整性、验证、锁定和解释，不构建 package、不运行产物、不发送反馈。

