# LLM Gateway Spec Round 02

## 当前草稿判断

第二版已经有 normalization，但仍可能越界：为了“好用”，它可能开始决定模型看什么、哪些 tool 可见、失败后是否继续 grow。

这些都不是 Gateway 的职责。

## 顶层视角检测

Context & Message Compiler 已经拥有 message list 编译和 source map。

Policy & Capability Boundary 拥有外部服务、网络、secret 和权限边界判断。

Grow Attempt Runner 后续拥有 attempt lifecycle、重试编排、tool settlement 和 trace。

LLM Gateway 只能做 provider 调用边界。

## 问题

需要修正：

```text
Gateway 不能补写 prompt section。
Gateway 不能因为 context_length 错误自行删上下文。
Gateway 不能执行 tool call。
Gateway 不能把模型输出总结成证据。
Gateway 不能因为模型说 ready 就更新 readiness。
```

它可以分类错误，可以执行 provider 层 retry/fallback，但这些动作必须保留 receipt 和原因，并由调用方决定是否继续 attempt。

## 调整

第三版规定：

```text
Gateway 读取 MessageListRef 或 provider-neutral messages。
Gateway 转换为 provider request。
Gateway 返回 normalized events、response、usage、finish reason、tool-call blocks 和 ProviderCallReceipt。
Gateway 执行的 retry/fallback 是 provider 层行为，不是 grow 决策。
Gateway 使用 PolicyDecision 表达外部 provider 调用允许，不拥有 secret storage。
```

## 进入下一轮的结论

下一轮需要收敛最终类型族：

```text
ModelCapabilitySummary。
LLMRequest。
NormalizedStreamEvent。
NormalizedLLMResponse。
ProviderCallReceipt。
LLMErrorClassification。
```
