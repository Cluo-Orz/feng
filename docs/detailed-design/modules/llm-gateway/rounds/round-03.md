# LLM Gateway Spec Round 03

## 当前草稿判断

第三版可以进入最终 spec。关键边界是：LLM Gateway 是协议适配与归一化层，不是 agent loop。

它只知道 provider-neutral message list 和 provider response，不知道 grow 是否该继续、是否 ready、是否 hatch。

## 顶层视角检测

feng 的核心 loop 可以小：message list -> LLM -> tool calls / output -> settlement -> 下一轮。但复杂度要在可解释 harness 层。LLM Gateway 就是 LLM 调用 harness 的底层之一。

它要把 provider 不稳定性收束起来，而不是把 provider 细节扩散到全部 grow 模块。

## 问题

最终 spec 必须避免：

```text
把 provider catalog 做成 feng 产品中心。
把 model selection 写成业务决策。
把 provider response 当完成证据。
把 tool-call block 当已执行动作。
把 retry/fallback 当 grow 策略。
```

## 调整

最终 spec 采用：

```text
ModelCapabilitySummary 表达模型能力和限制。
LLMRequest 表达一次模型调用请求。
ProviderRequest 是内部转换结果。
NormalizedStreamEvent 表达统一流式事件。
NormalizedLLMResponse 表达完整响应。
ProviderCallReceipt 表达调用、retry、fallback、usage 和错误。
```

Grow Attempt Runner 后续拥有 attempt trace；Gateway 提供可被 trace 引用的 normalized output 和 receipt。

## 进入下一轮的结论

本模块可以进入最终 spec。

最终 spec 必须保留这些硬约束：

```text
LLM Gateway 不编译 message list。
LLM Gateway 不调用工具。
LLM Gateway 不判断 readiness。
LLM Gateway 不拥有 prompt 语义。
LLM Gateway 不保存 secret。
LLM Gateway 必须归一化错误和 streaming events。
```
