# LLM Gateway Spec

本文是 `LLM Gateway` 模块的 SDD spec。它描述该模块完成后的终态事实。

## 模块定位

`LLM Gateway` 是 provider-neutral message list 到具体 LLM provider 调用的协议适配、能力摘要、流式输出归一化和错误归一化层。

它封装 provider/model 差异，但不拥有 prompt 语义、grow 目标、工具权限、tool execution、readiness 或 hatch 判断。

## 职责

该模块负责：

```text
维护 provider/model capability summary。
接收 provider-neutral message list 或 MessageListRef。
构建 provider request。
执行 provider 调用。
归一化 streaming events。
归一化 tool-call blocks。
归一化完整 response。
归一化 usage、finish reason 和 stop reason。
分类 provider/network/auth/rate-limit/context/tool-call parse 错误。
执行 provider 层 retry/fallback。
生成 ProviderCallReceipt。
返回 normalized response 或 stream。
```

该模块不负责：

```text
message list 编译。
prompt section 选择。
输入和反馈准入。
skill 选择或执行。
工具权限判断。
工具执行。
tool result 归档。
attempt lifecycle。
readiness verdict。
evidence 判断。
provider credential storage。
provider/model 产品管理界面。
具体 provider adapter 配置文件 schema。
```

## 依赖关系

```text
Depends on:
  Domain Model & Contracts
  File-Native Store
  Event Ledger & Projection
  Artifact Registry
  Policy & Capability Boundary
  Context & Message Compiler

Used by:
  Grow Attempt Runner
  Evidence & Readiness
  Agent Runtime Kernel
  Debug & Feedback Bridge
  CLI
```

事实：

```text
LLM Gateway 可以通过 Artifact Registry materialize compiled_message_list artifact。
LLM Gateway 使用 PolicyDecision 表达外部 provider 调用、网络访问或 external_service.call 已被允许。
LLM Gateway 不直接依赖 Tool Runtime。
LLM Gateway 不写 grow lifecycle。
```

## Model Capability Summary

ModelCapabilitySummary 表达 provider/model 的能力和限制。

它至少包含：

```text
provider
model
modelVersion
contextLimit
outputLimit
supportsStreaming
supportsToolCalls
supportsStructuredOutput
supportsMultimodalInput
supportsReasoningTrace
toolCallFormat
requestLimits
knownUnsupportedFeatures
source
version
audit
```

事实：

```text
capability summary 是调用能力事实，不是业务选择。
未知能力必须显式表示为 unknown 或 unsupported。
能力不足时返回 model_capability_unsupported，不静默降级。
```

## LLM Request

LLMRequest 表达一次模型调用。

LLMRequest 至少包含：

```text
requestId
messageListRef
providerNeutralMessages
modelSelection
requiredCapabilities
toolSurfaceSummary
streaming
timeout
retryPolicy
fallbackPolicy
policyDecisionId
correlationId
source
audit
```

事实：

```text
messageListRef 来自 Context & Message Compiler。
providerNeutralMessages 不由 Gateway 编译。
toolSurfaceSummary 只用于 request conversion，不表示工具可执行。
policyDecisionId 表示外部 provider 调用边界。
```

## Provider Request

ProviderRequest 是 Gateway 内部生成的 provider-specific 请求。

事实：

```text
ProviderRequest 不是跨模块业务事实。
ProviderRequest 不反向改写 MessageListRef。
ProviderRequest 的构建必须可由 ProviderCallReceipt 解释。
```

## Normalized Stream Event

NormalizedStreamEvent 统一表达流式输出。

事件类型至少包括：

```text
response_started
text_delta
reasoning_delta
tool_call_started
tool_call_delta
tool_call_completed
usage_delta
response_completed
response_failed
provider_warning
```

事实：

```text
stream event 是模型输出归一化，不是 tool execution。
tool_call_completed 只表示模型提出了 tool call block。
stream interruption 返回 explicit error event。
```

## Normalized LLM Response

NormalizedLLMResponse 表达完整模型响应。

它至少包含：

```text
requestId
provider
model
contentBlocks
toolCallBlocks
usage
finishReason
stopReason
providerMetadataSummary
receiptRef
source
audit
```

content block 至少能表达：

```text
text
reasoning_summary
structured_output
tool_call
refusal_or_safety_notice
unknown
```

事实：

```text
NormalizedLLMResponse 不表示 attempt 成功。
toolCallBlocks 不表示工具已执行。
refusal_or_safety_notice 是模型输出分类，不是 policy decision。
```

## Provider Call Receipt

ProviderCallReceipt 表达一次 provider 调用的执行事实。

它至少包含：

```text
requestId
messageListRef
provider
model
startedAt
completedAt
streaming
retryCount
fallbackUsed
usage
finishReason
errorClassification
policyDecisionId
correlationId
contentHash
source
audit
```

事实：

```text
receipt 可被 Grow Attempt Runner 引用进 attempt trace。
receipt 不替代 attempt trace。
receipt 不包含 secret。
retry/fallback 必须记录原因。
```

## Error Classification

错误分类至少包括：

```text
provider_unavailable
network_failed
timeout
rate_limited
auth_failed
permission_denied
policy_blocked
context_length_exceeded
model_capability_unsupported
request_invalid
response_invalid
stream_interrupted
tool_call_parse_failed
content_filtered
provider_internal_error
unknown_provider_error
```

事实：

```text
业务失败通过 Result<DomainError> 表达。
provider 原始错误不要求调用方解析自然语言。
context_length_exceeded 不允许 Gateway 自行删除上下文后重试，除非请求带有明确 fallback policy。
```

## Ports

### Capability Port

```text
listProviders() -> Result<ProviderList>
getModelCapabilities(provider, model) -> Result<ModelCapabilitySummary>
checkModelCapabilities(requirements) -> Result<ModelCapabilityCheck>
```

事实：

```text
capability check 只说明模型是否支持请求能力。
capability check 不决定 grow strategy。
```

### Request Port

```text
buildProviderRequest(request) -> Result<ProviderRequestSummary>
sendLLMRequest(request) -> Result<NormalizedLLMResponse>
streamLLMRequest(request) -> AsyncResult<NormalizedStreamEvent>
```

事实：

```text
sendLLMRequest 和 streamLLMRequest 都要求有效 policyDecisionId。
buildProviderRequest 不调用 provider。
stream 输出按 NormalizedStreamEvent 表达。
```

### Normalization Port

```text
normalizeProviderResponse(rawResponse) -> Result<NormalizedLLMResponse>
normalizeProviderStream(rawEvent) -> Result<NormalizedStreamEvent>
normalizeProviderError(error) -> Result<LLMErrorClassification>
```

事实：

```text
normalization 不解释 grow 语义。
无法识别的 block 返回 unknown 或 response_invalid，不静默丢弃。
```

## 事件与 Trace

LLM Gateway 可以产生 provider call receipt 和 normalized events。Grow Attempt Runner 拥有 attempt trace 的最终归档。

事件类型至少包括：

```text
llm_request_started
llm_stream_event_normalized
llm_response_completed
llm_request_failed
llm_retry_performed
llm_fallback_performed
model_capability_checked
```

事实：

```text
Gateway events 可以被 Grow Attempt Runner 写入 attempt trace。
Gateway 不直接写 grow lifecycle。
大型 provider response 通过 ArtifactRef 或 receiptRef 关联，不内联进业务事件。
```

## 与其他模块的边界

### Context & Message Compiler

Context Compiler 创建 provider-neutral message list。

LLM Gateway 把 provider-neutral message list 转换为 provider request。

事实：

```text
Gateway 不编译 message list。
Gateway 不修改 source map。
```

### Policy & Capability Boundary

Policy 判断 network.request、external_service.call、secret.read 等边界。

Gateway 使用 policyDecisionId。

事实：

```text
Gateway 不保存 secret。
policy deny 时 provider 调用不执行。
```

### Grow Attempt Runner

Grow Attempt Runner 编排 attempt lifecycle、重试边界、tool settlement 和 trace。

Gateway 返回 normalized response、stream events 和 receipt。

事实：

```text
Gateway retry/fallback 是 provider 层执行，不等于 attempt retry strategy。
Gateway response 不等于 attempt success。
```

### Tool Runtime

Tool Runtime 执行工具。

Gateway 只归一化模型提出的 tool-call blocks。

事实：

```text
tool-call block 不等于工具执行。
Gateway 不校验最终工具输入权限。
```

### Evidence & Readiness

Evidence & Readiness 判断证据和 readiness。

Gateway 不判断模型回答是否足以 hatch。

## 不变量

```text
LLM Gateway 不编译 message list。
LLM Gateway 不拥有 prompt 语义。
LLM Gateway 不执行工具。
LLM Gateway 不判断 readiness。
LLM Gateway 不写 grow lifecycle。
LLM Gateway 不保存 secret。
provider response 不等于 evidence verdict。
tool-call block 不等于 tool result。
context_length_exceeded 不允许静默删上下文。
所有 provider 错误必须归一化。
```

## 错误行为

该模块使用 `Result<DomainError>` 表达业务失败。

错误 code 至少覆盖：

```text
llm_failed
permission_denied
policy_blocked
version_unsupported
schema_incompatible
artifact_unavailable
context_budget_exceeded
provider_unavailable
network_failed
timeout
rate_limited
auth_failed
context_length_exceeded
model_capability_unsupported
request_invalid
response_invalid
stream_interrupted
tool_call_parse_failed
content_filtered
```

事实：

```text
MessageListRef 不可读取时返回 artifact_unavailable。
policyDecisionId 无效时返回 policy_blocked 或 permission_denied。
provider 不支持 requiredCapabilities 时返回 model_capability_unsupported。
stream 中断返回 stream_interrupted，并保留已归一化事件摘要。
```

## 验证要求

实现阶段应验证：

```text
Gateway 不能 import Context Compiler 的编译逻辑，只消费 MessageListRef 或 provider-neutral messages。
Gateway 不能 import Tool Runtime。
policy deny 时不会发起 provider call。
tool-call block 只归一化，不执行。
context_length_exceeded 不触发静默 prompt 删除。
streaming 与 non-streaming 都能产生 ProviderCallReceipt。
provider 原始错误被映射到 DomainError code。
NormalizedLLMResponse 不会触发 ready_to_hatch。
```

## 开放问题

```text
provider adapter 的具体配置 schema 属于实现阶段。
credential storage 需要与 Policy、Tool Runtime 或专门凭据模块联合确认。
provider-neutral message 最小结构需要与 Context & Message Compiler 联合收敛。
model selection 的默认策略需要等 Grow Attempt Runner spec 确认调用方如何表达需求。
```

这些问题不影响本模块当前终态事实：LLM Gateway 是 provider 调用、能力摘要、事件归一化和错误归一化层，不是 prompt 编译器、工具执行器或 readiness 裁判。
