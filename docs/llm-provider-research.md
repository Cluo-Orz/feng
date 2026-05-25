# Feng LLM Provider 调研

更新时间：2026-05-25

## 0. 安全边界

用户提供过 DeepSeek key。这个 key 不应写入仓库、文档、日志、artifact 或 release package。

文档和配置只能使用环境变量占位：

```text
DEEPSEEK_API_KEY
OPENAI_API_KEY
ANTHROPIC_API_KEY
```

已经暴露过的 key 应视为泄露凭据，建议轮换。

## 1. 结论

feng 的 LLM 设计应该分三层：

```text
Feng LLM 调用层
  feng 内部唯一稳定接口。只理解 Message、Tool、ToolCall、ToolResult、Usage、Capability。

协议层
  OpenAI-compatible adapter。
  Anthropic Messages adapter。
  负责把 feng 内部结构编译成厂商协议。

Provider 配置层
  某个具体供应商和模型的配置，例如 deepseek。
  负责 base_url、api_key_env、model、capabilities、cache 行为、reasoning 行为。
```

DeepSeek 不应该被写死进 feng 的核心调用层。它应该是一个 provider profile：

```text
provider: deepseek
protocol: openai_chat
base_url: https://api.deepseek.com
api_key_env: DEEPSEEK_API_KEY
```

如果需要 Anthropic 兼容入口，则是另一个 profile：

```text
provider: deepseek-anthropic
protocol: anthropic_messages
base_url: https://api.deepseek.com/anthropic
api_key_env: DEEPSEEK_API_KEY
```

## 2. Feng LLM 调用层

### 2.1 核心原则

Feng LLM 调用层只表达 feng 自己需要的概念，不暴露厂商字段：

```text
LLMRequest
LLMResponse
Message
Tool
ToolCall
ToolResult
Usage
Capability
ProviderProfile
```

这层负责：

```text
接收 message compiler 的输出
接收 active tool pack
调用 provider adapter
返回 assistant text / tool calls / usage / cache metrics / raw metadata
把错误归一化
```

这层不负责：

```text
存 API key
知道 DeepSeek 特殊参数
直接拼 OpenAI 或 Anthropic JSON
保存长上下文
绕过 permissions
```

### 2.2 内部 Request

建议内部请求结构：

```yaml
provider: deepseek
model: deepseek-chat
mode: grow
messages: []
tools: []
tool_choice: auto
temperature: 0.2
top_p: null
max_output_tokens: 4096
stream: true
response_format: null
reasoning:
  enabled: false
  effort: null
cache:
  stable_prefix_hash: "..."
  active_tool_pack_hash: "..."
  context_pack_hash: "..."
metadata:
  self_commit: "..."
  run_id: "..."
  user_id: null
```

### 2.3 内部 Message

Feng 内部 message 必须保留 message compiler 的语义：

```yaml
role: system | user | assistant | tool
layer: kernel_contract | self_contract | cached_context | state_manifest | conversation_suffix | latest_event
content: []
source: "self/skills/code-review.md"
priority: 100
budget_tokens: 1200
hash: "..."
cache_hint: stable | dynamic | no_cache
```

content block 建议统一为：

```yaml
type: text | artifact_ref | tool_call | tool_result
text: "..."
artifact_ref:
  type: test-log
  source: npm-test
  path: .feng/artifacts/...
  hash: "..."
  summary: "..."
  why_relevant: "..."
  snippets: []
```

### 2.4 内部 Tool

Tool 是 feng 的统一 function-call 表达：

```yaml
name: read_file
description: Read a UTF-8 text file.
input_schema:
  type: object
  properties:
    path:
      type: string
  required: [path]
permission:
  scope: file.read
source: bootstrap | self_repo
```

注意：

```text
工具说明全文留在 tools/ 文件中。
prompt 里只暴露 active tool pack 的可调用 schema。
每次 tool call 仍要过 permissions。
```

### 2.5 内部 ToolCall / ToolResult

```yaml
tool_call:
  id: call_xxx
  name: read_file
  arguments:
    path: docs/architecture.md

tool_result:
  tool_call_id: call_xxx
  is_error: false
  content:
    - type: text
      text: "short result"
    - type: artifact_ref
      artifact_ref: {...}
```

长结果必须 artifact 化：

```text
短结果进 tool message
长结果进 .feng/artifacts/
tool message 只返回 type/source/path/hash/summary/why_relevant/snippets
```

### 2.6 Usage 和缓存指标

Feng 至少归一化这些指标：

```yaml
usage:
  input_tokens: 0
  output_tokens: 0
  cached_input_tokens: 0
  cache_write_tokens: 0
  cache_miss_tokens: 0
  reasoning_tokens: 0
  tool_schema_tokens: 0
  dynamic_suffix_tokens: 0
```

不同 provider 字段不一致，adapter 负责映射。

### 2.7 Capability

每个 provider/model profile 必须声明 capability：

```yaml
supports:
  streaming: true
  tool_calling: true
  parallel_tool_calls: unknown
  strict_tool_schema: false
  json_object: true
  structured_output: false
  prompt_cache: automatic
  explicit_cache_control: false
  reasoning: true
  images: false
  documents: false
```

Feng kernel 根据 capability 决定：

```text
是否启用 tool call
是否启用 strict schema
是否可依赖 provider 缓存
是否允许 reasoning 参数
是否需要降级到纯文本 JSON
```

### 2.8 Stream Event

Feng 内部不应直接暴露厂商 stream event。

统一事件建议：

```yaml
type: message_start | text_delta | tool_call_start | tool_call_delta | tool_call_done | usage_delta | message_done | error
message_id: "..."
tool_call_id: "..."
delta: "..."
usage: {}
raw: {}
```

原因：

```text
OpenAI Responses、OpenAI Chat Completions、Anthropic Messages 和 DeepSeek compatibility 的 streaming 事件形态不同。
但 feng loop 只需要知道文本增量、tool call 增量、usage、完成和错误。
```

### 2.9 Tool Choice

内部 tool choice 建议只保留通用语义：

```yaml
tool_choice:
  mode: auto | none | required | named
  name: null
```

协议 adapter 负责降级：

```text
OpenAI-compatible
  auto / none / required / named 通常可映射到 tool_choice。

Anthropic
  auto / none / any / tool。
  extended thinking 下，any/tool 可能不可用，只能 auto/none。

DeepSeek
  以当前 profile capability 为准。
```

Feng 默认应使用 `auto`。只有 check/eval 需要强制工具时，才使用 required/named。

### 2.10 Structured Output

Feng 内部只表达意图：

```yaml
response_format:
  kind: text | json_object | json_schema
  schema: null
  strict: false
```

adapter 决定具体实现：

```text
OpenAI
  json_schema / structured outputs 优先。
  JSON mode 可用但不保证 schema。

Anthropic
  可用 tool strategy 或模型结构化输出能力。
  不要假设所有模型都有 OpenAI 式 response_format。

DeepSeek
  支持 response_format: {"type":"json_object"}。
  prompt 中也必须明确要求 JSON。
```

Feng check 阶段仍需要本地 JSON schema validation，不应完全信任 provider。

### 2.11 Token Counting

Token 估算应分两层：

```text
preflight estimate
  feng 本地估算，用于 context budget 和截断。

provider usage
  provider 返回真实 input/output/cache/reasoning tokens，用于记录和优化。
```

Feng 不需要在 MVP 中做到每家 tokenizer 精确一致，但必须记录 provider usage。

### 2.12 Message 编排和恢复边界

Feng 的 message compiler 必须先生成 provider-neutral message layers，再交给 OpenAI-compatible 或 Anthropic adapter。

稳定顺序：

```text
provider tools
system: kernel contract
system: self contract
optional cached context pack
user: state manifest
conversation suffix
user: latest event
```

缓存 key 至少包含：

```text
provider
model
mode
stable_prefix_hash
active_tool_pack_hash
self_commit_or_tag
context_pack_hash
provider_capability_hash
```

当 tool growth、permission、provider capability 或 skill/world cached pack 改变时，active prefix 必须重新计算。不能用旧缓存隐藏新工具，也不能为了缓存命中把所有工具永久塞进 prompt。

Provider 错误恢复由 Feng LLM 调用层统一处理：

```text
max_tokens / output truncated
  adapter 返回 stop reason，kernel 决定提高输出预算或 continuation。

prompt_too_long
  adapter 归一化为 prompt_too_long，kernel 触发 reactive compact。

429 / 500 / 503
  adapter 标记 transient，kernel 退避重试。

401 / 402 / missing_config
  adapter 标记 config/account 错误，kernel 不重试。

400 / 422
  adapter 标记 request_error，写 artifact 供 grow 修复 message/tool/schema。
```

恢复状态不进入 self repo。它写入 `.feng/events.jsonl` 和 `.feng/artifacts/`，下一轮通过 artifact refs 进入 context。

## 3. 协议层：OpenAI-compatible

### 3.1 推荐定位

OpenAI-compatible adapter 是 feng 的 MVP 主协议之一。

原因：

```text
DeepSeek OpenAI 入口兼容 Chat Completions。
OpenAI Chat Completions 的 messages/tools/tool_calls 结构足够表达 feng MVP。
很多第三方 provider 也兼容这个协议。
```

OpenAI 原生 Responses API 可以作为未来 adapter，但不要让 MVP 同时依赖两套 OpenAI 原生表述。

### 3.2 请求形态

OpenAI Chat Completions 典型请求：

```json
{
  "model": "MODEL",
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "Read a file",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {"type": "string"}
          },
          "required": ["path"]
        }
      }
    }
  ],
  "tool_choice": "auto",
  "stream": true
}
```

### 3.3 Message 映射

```text
feng system/kernel_contract -> OpenAI system 或 developer/system
feng system/self_contract   -> OpenAI system
feng cached context pack    -> OpenAI system 或 user，保持稳定前缀
feng state manifest         -> OpenAI user
feng latest event           -> OpenAI user
feng assistant              -> OpenAI assistant
feng tool_result            -> OpenAI tool，带 tool_call_id
```

为了 DeepSeek 兼容，MVP 应使用最保守 roles：

```text
system
user
assistant
tool
```

### 3.4 Tool Call 映射

OpenAI assistant 返回：

```json
{
  "role": "assistant",
  "tool_calls": [
    {
      "id": "call_x",
      "type": "function",
      "function": {
        "name": "read_file",
        "arguments": "{\"path\":\"docs/architecture.md\"}"
      }
    }
  ]
}
```

Feng 执行工具后追加：

```json
{
  "role": "tool",
  "tool_call_id": "call_x",
  "content": "..."
}
```

### 3.5 缓存

OpenAI Prompt Caching 关键点：

```text
缓存针对重复前缀。
命中情况可从 usage 中的 cached_tokens 观察。
工具定义、messages、structured output schema 等稳定前缀都影响缓存。
```

对 feng 的设计影响：

```text
provider tools 必须稳定且尽量小。
system/kernel/self contract 稳定前置。
latest event 和 tool response 靠后。
大内容文件化，只给 artifact refs。
缓存 key 至少包含 stable_prefix_hash、active_tool_pack_hash、context_pack_hash、model。
```

### 3.6 OpenAI-compatible 风险

不同 provider 声称 OpenAI-compatible，但细节可能不同：

```text
支持的 model 参数不同。
strict schema 支持不同。
JSON mode 支持不同。
stream event 细节不同。
usage 字段不同。
错误码和 rate-limit header 不同。
```

因此 feng 不能只靠 `protocol=openai_chat`，还需要 `capabilities`。

### 3.7 OpenAI Structured Outputs

OpenAI Structured Outputs 支持两条路线：

```text
function calling strict schema
response_format json_schema
```

JSON mode 只保证合法 JSON，不保证匹配 schema。

对 feng 的影响：

```text
工具参数更适合用 function calling strict schema。
assistant 最终答复需要结构化时，才用 response_format。
如果 provider 不支持 strict schema，则用 JSON mode + 本地校验 + 重试。
```

### 3.8 OpenAI Responses API

OpenAI 原生建议逐步使用 Responses API。

但 feng MVP 不应同时把 Responses 和 Chat Completions 混进核心层：

```text
Feng 内部仍是 Message / Tool / ToolCall。
OpenAI Chat adapter 用于 OpenAI-compatible provider。
OpenAI Responses adapter 可以作为未来原生 OpenAI adapter。
```

原因：

```text
DeepSeek 主要兼容 Chat Completions。
Responses 的 tool call 和 tool output 是 item/call_id 形态。
这个差异应留在 adapter。
```

## 4. 协议层：Anthropic Messages

### 4.1 推荐定位

Anthropic Messages adapter 是 feng 的第二个 MVP 协议。

它和 OpenAI 的差异不是简单字段名不同，而是 message 形态不同：

```text
system 是 top-level 字段，不是 messages 里的 system role。
messages 主要是 user / assistant。
tool_use 和 tool_result 是 content blocks。
tool_result 通常放在 user message 中。
max_tokens 是必填请求参数。
```

### 4.2 请求形态

Anthropic Messages 典型请求：

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 4096,
  "system": [
    {"type": "text", "text": "kernel contract"},
    {"type": "text", "text": "self contract"}
  ],
  "messages": [
    {
      "role": "user",
      "content": [{"type": "text", "text": "latest event"}]
    }
  ],
  "tools": [
    {
      "name": "read_file",
      "description": "Read a file",
      "input_schema": {
        "type": "object",
        "properties": {
          "path": {"type": "string"}
        },
        "required": ["path"]
      }
    }
  ]
}
```

### 4.3 Message 映射

```text
feng kernel_contract -> Anthropic top-level system block
feng self_contract   -> Anthropic top-level system block
feng cached context  -> system block 或早期 user block，按 cache 策略放前面
feng state manifest  -> user content block
feng latest event    -> user content block
feng assistant text  -> assistant content text block
feng tool call       -> assistant content tool_use block
feng tool result     -> user content tool_result block
```

### 4.4 Tool Call 映射

Anthropic assistant 返回 content block：

```json
{
  "type": "tool_use",
  "id": "toolu_x",
  "name": "read_file",
  "input": {"path": "docs/architecture.md"}
}
```

Feng 执行工具后，下一轮 user message 包含：

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_x",
  "content": "..."
}
```

### 4.5 Prompt Caching

Anthropic Prompt Caching 关键点：

```text
缓存从前缀开始生效。
常见顺序是 tools -> system -> messages。
cache_control breakpoint 可以标记缓存边界。
usage 中有 cache creation/read 相关 token。
```

对 feng 的设计影响：

```text
tools 必须 active pack 化，否则 tools tokens 会膨胀。
system contract 应稳定。
cached context pack 应在动态 latest event 之前。
tool_result 这种动态内容应靠后。
```

### 4.6 Anthropic 风险

Anthropic 协议和 OpenAI-compatible 的结构差异较大：

```text
没有 messages system role。
tool_result 是 user content block。
tool_use 是 assistant content block。
max_tokens 必填。
cache_control 是 Anthropic 原生字段，不一定被兼容 provider 支持。
```

因此 feng 不能把 OpenAI messages 直接透传到 Anthropic。

### 4.7 Anthropic Tool Choice

Anthropic tool_choice 常见模式：

```text
auto
any
tool
none
```

注意：

```text
extended thinking 与强制 any/tool 可能冲突。
tool_choice 变化可能影响 prompt cache。
```

对 feng 的影响：

```text
默认 auto。
需要禁止工具时用 none。
需要强制工具时，先检查 capability 和 reasoning 配置。
```

### 4.8 Anthropic 工具描述成本

Anthropic 文档强调工具 description 对工具表现非常重要，但 description 会进入构造的系统提示并消耗 token。

对 feng 的影响：

```text
tools/ 文件中可以保留长说明。
active tool pack 中只放当前工具的必要 schema 和高信号描述。
复杂工具可用少量 input_examples，但必须计入 tool schema tokens。
```

## 5. Provider 配置层：DeepSeek

### 5.1 DeepSeek 作为 provider，不作为核心协议

DeepSeek 当前可以通过两种方式接入：

```text
OpenAI-compatible
  base_url: https://api.deepseek.com
  endpoint: /chat/completions

Anthropic-compatible
  base_url: https://api.deepseek.com/anthropic
  endpoint: /v1/messages
```

Feng 应把它们建模为两个 provider profile，而不是在核心调用层写 if deepseek。

### 5.2 DeepSeek OpenAI-compatible 配置

```yaml
llm:
  default_provider: deepseek
  providers:
    deepseek:
      protocol: openai_chat
      base_url: https://api.deepseek.com
      api_key_env: DEEPSEEK_API_KEY
      default_model: deepseek-chat
      models:
        deepseek-chat:
          supports:
            streaming: true
            tool_calling: true
            json_object: true
            prompt_cache: automatic_disk
            explicit_cache_control: false
            reasoning: false
            images: false
            documents: false
        deepseek-v4-pro:
          supports:
            streaming: true
            tool_calling: true
            json_object: true
            prompt_cache: automatic_disk
            explicit_cache_control: false
            reasoning: true
            images: false
            documents: false
        deepseek-v4-flash:
          supports:
            streaming: true
            tool_calling: true
            json_object: true
            prompt_cache: automatic_disk
            explicit_cache_control: false
            reasoning: true
```

### 5.3 DeepSeek Anthropic-compatible 配置

```yaml
llm:
  providers:
    deepseek-anthropic:
      protocol: anthropic_messages
      base_url: https://api.deepseek.com/anthropic
      api_key_env: DEEPSEEK_API_KEY
      default_model: deepseek-chat
      compatibility:
        prompt_cache_control: ignored
        anthropic_version_header: required_by_sdk
      supports:
        streaming: true
        tool_calling: true
        prompt_cache: automatic_disk
        explicit_cache_control: false
        images: false
        documents: false
```

### 5.4 DeepSeek key 配置

不要把 key 写入 YAML。

本机配置：

```powershell
$env:DEEPSEEK_API_KEY = "..."
```

Linux/macOS：

```bash
export DEEPSEEK_API_KEY="..."
```

release package 不包含 key。使用者首次运行时由 `config.schema.yaml` 引导配置。

### 5.4.1 Provider 配置文件位置

DeepSeek provider profile 是本机配置，不是 self repo 的一部分。

推荐：

```text
Windows
  %APPDATA%\feng\providers\deepseek.yaml

Linux / macOS
  ~/.config/feng/providers/deepseek.yaml
```

Workspace 可以引用 provider 名称，但不能保存 key：

```yaml
# self/feng.yaml 或 workspace 配置中的非 secret 引用
llm:
  provider: deepseek
  model: deepseek-chat
```

用户本机 provider profile 保存：

```yaml
id: deepseek
protocol: openai_chat
base_url: https://api.deepseek.com
api_key_env: DEEPSEEK_API_KEY
default_model: deepseek-chat
```

这样 hatch package 可以传播：

```text
self repo
provider requirement
config.schema.yaml
```

但不传播：

```text
API key
用户本机 provider profile
本机 proxy / endpoint override
```

### 5.4.2 DeepSeek 示例配置文件

示例文件：

```text
docs/llm-provider-research/deepseek.provider.example.yaml
```

该文件只展示结构，不包含真实 key。

### 5.5 DeepSeek 模型和别名

DeepSeek 文档当前重点模型：

```text
deepseek-v4-pro
deepseek-v4-flash
```

文档说明旧别名：

```text
deepseek-chat
deepseek-reasoner
```

会映射到 `deepseek-v3.2-exp`，并将在 2026-07-24 下线。

Feng 配置不应默认使用即将下线的别名。

### 5.6 DeepSeek Function Calling

DeepSeek OpenAI-compatible function calling 支持：

```text
tools
tool_choice
tool_calls
role=tool 的 tool response
```

文档说明最多支持 128 个 tools。

对 feng 的影响：

```text
active tool pack 是必须的。
工具多了不能全部暴露。
tool schema 必须小而稳定。
```

Strict mode 属于 beta 能力，DeepSeek 文档要求使用 beta base URL：

```text
https://api.deepseek.com/beta
```

因此 strict tool schema 必须是 capability，不是默认假设。

### 5.7 DeepSeek JSON Output

DeepSeek 支持 JSON Output：

```json
{"response_format": {"type": "json_object"}}
```

文档要求 prompt 中明确要求输出 JSON。

对 feng 的影响：

```text
需要 JSON 时，adapter 同时设置 response_format，并在 latest event 或 kernel contract 中说明 JSON 输出要求。
不能只依赖 response_format。
```

### 5.8 DeepSeek Thinking / Reasoning

DeepSeek 当前文档提供 Thinking mode：

```text
thinking 默认 enabled。
reasoning_effort 可用 high / max。
```

OpenAI-compatible 调用可通过 extra_body：

```json
{
  "extra_body": {
    "reasoning_effort": "high"
  }
}
```

Anthropic-compatible 调用可用：

```json
{
  "thinking": {"type": "enabled", "budget_tokens": 4096},
  "output_config": {"thinking": {"effort": "high"}}
}
```

DeepSeek 文档说明 Anthropic 兼容模式下 `thinking.budget_tokens` 会被忽略，实际由 `output_config.thinking.effort` 控制。

对 feng 的影响：

```text
reasoning 是 provider capability。
不能把 reasoning 参数写进通用 Message。
不同协议由 adapter 编译。
grow 可以默认 high，execute 可默认关闭或低成本。
```

### 5.9 DeepSeek Prompt Cache

DeepSeek 文档说明：

```text
默认启用硬盘缓存。
用户不需要代码修改。
请求命中缓存时价格更低。
usage 会返回 prompt_cache_hit_tokens / prompt_cache_miss_tokens。
user 参数可用于缓存隔离、隐私保护和调度。
```

对 feng 的影响：

```text
继续坚持 stable prefix + dynamic suffix。
记录 cache hit/miss tokens。
DeepSeek 的缓存不是 Anthropic cache_control。
DeepSeek Anthropic 兼容接口会忽略 cache_control，但仍可能使用 DeepSeek 自己的默认缓存。
```

### 5.10 DeepSeek Error Handling

Feng adapter 至少归一化：

```text
400 invalid request
401 authentication failed
402 insufficient balance
422 invalid parameters
429 rate limit
500 server error
503 server overloaded
```

策略：

```text
401/402 不重试，提示配置或余额。
400/422 不重试，写入 artifact 供 agent 修复请求。
429/500/503 可指数退避重试。
```

### 5.11 DeepSeek Streaming

DeepSeek OpenAI-compatible streaming 应由 `openai_chat` adapter 处理。

Feng 只关心归一化事件：

```text
text_delta
tool_call_delta
usage_delta
message_done
error
```

如果 DeepSeek 某模型或某兼容入口不返回完整 usage delta，adapter 在结束时补齐或标记 unknown。

### 5.12 DeepSeek token usage 映射

DeepSeek cache usage 字段需要映射到 feng：

```text
prompt_cache_hit_tokens  -> cached_input_tokens
prompt_cache_miss_tokens -> cache_miss_tokens
```

如果返回标准 OpenAI usage，则同时读取：

```text
prompt_tokens
completion_tokens
total_tokens
```

Feng 记录原始 usage 到 raw metadata，避免未来字段变化导致信息丢失。

## 6. 三层映射总表

| Feng 概念 | OpenAI-compatible | Anthropic Messages | DeepSeek 配置 |
| --- | --- | --- | --- |
| system/kernel | system message | top-level system block | 无 provider 特殊字段 |
| system/self | system message | top-level system block | 无 provider 特殊字段 |
| user latest event | user message | user content block | 无 provider 特殊字段 |
| assistant text | assistant message | assistant text block | 无 provider 特殊字段 |
| tool call | assistant.tool_calls | assistant tool_use block | tool_calling capability |
| tool result | role=tool + tool_call_id | user tool_result block | 长结果 artifact 化 |
| tools | tools[].function | tools[].input_schema | active tool pack |
| JSON output | response_format | tool/JSON prompt or provider feature | json_object capability |
| cache read | cached_tokens | cache_read_input_tokens | prompt_cache_hit_tokens |
| cache write/miss | provider specific | cache_creation_input_tokens | prompt_cache_miss_tokens |
| reasoning | reasoning/extra_body/provider field | thinking/output_config | reasoning capability |

## 7. Feng 实现清单

MVP 需要实现：

```text
1. ProviderProfile 读取。
2. OpenAI-compatible adapter。
3. Anthropic Messages adapter。
4. DeepSeek provider profile。
5. Message compiler 到两种协议。
6. Tool / ToolCall / ToolResult 归一化。
7. Tool response artifact 化。
8. Usage/cache metrics 归一化。
9. Capability gating。
10. Error normalization。
11. 不把 API key 写进 self repo 或 release package。
12. Stream event 归一化。
13. Tool choice capability gating。
14. Structured output 降级策略。
15. Token usage 和 cache usage 映射。
16. 本机 provider profile 加载。
17. self repo 只引用 provider/model，不保存 secret。
```

暂时不做：

```text
复杂 provider router
自动 benchmark 选模型
跨 provider prompt DSL
复杂 RAG
把所有厂商参数暴露给 self repo
```

## 8. 调研来源

OpenAI：

- https://platform.openai.com/docs/guides/function-calling
- https://platform.openai.com/docs/guides/prompt-caching
- https://platform.openai.com/docs/api-reference/chat/create
- https://platform.openai.com/docs/api-reference/responses

Anthropic：

- https://docs.anthropic.com/en/api/messages
- https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview
- https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

DeepSeek：

- https://api-docs.deepseek.com/zh-cn/
- https://api-docs.deepseek.com/zh-cn/api/create-chat-completion
- https://api-docs.deepseek.com/zh-cn/guides/function_calling
- https://api-docs.deepseek.com/zh-cn/guides/json_mode
- https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
- https://api-docs.deepseek.com/zh-cn/guides/kv_cache
- https://api-docs.deepseek.com/zh-cn/guides/anthropic_api
- https://api-docs.deepseek.com/zh-cn/quick_start/pricing
- https://api-docs.deepseek.com/zh-cn/quick_start/error_codes
