# 第 7 轮改进文档

## 1. 总体判断

当前架构主线不需要变，但 message list 的顺序需要从“语义分层”改成“缓存友好分层”。

核心目标只有一个：

```text
token efficiency
```

## 2. 改进一：上下文从语义分层改为缓存分层

### 问题

旧设计强调：

```text
core
selected
working
history
```

这个分法能解释内容来源，但不能指导缓存命中。

### 建议

改为：

```text
cache prefix
hot suffix
artifact refs
summary
```

稳定内容进入 prefix，动态内容进入 suffix，大内容进入文件。

## 3. 改进二：Message List 顺序

### 问题

旧顺序里 event 太靠前，容易破坏稳定上下文的缓存价值。

### 建议

改为：

```text
provider tools
system: kernel contract
system: self contract
optional cached context pack
user: state manifest
conversation suffix
user: latest event
```

其中：

```text
稳定输出约束放 kernel contract
任务特定输出要求放 latest event
assistant 只保留 few-shot 或必要行动历史
tool response 长结果文件化
```

## 4. 改进三：Active Tool Pack

### 问题

feng 允许 agent 自己造工具。工具越来越多后，如果每轮暴露所有 schema，token 成本会膨胀。

### 建议

只暴露当前 active tool pack。

第一版不需要复杂 router：

```text
bootstrap tools 常驻
当前 skill 需要的领域工具进入 active tool pack
工具文档全文留在 tools/ 文件中
prompt 里只放可调用 schema
```

active tool pack 不要每轮随意变化，应尽量在任务阶段内稳定，以提高缓存命中。

## 5. 改进四：Token 可观测性

### 问题

没有 token 指标，无法判断 context engineering 是否有效。

### 建议

运行时至少记录：

```text
prompt tokens
cached tokens
tool schema tokens
artifact-ref tokens
dynamic suffix tokens
```

这些指标写入 `.feng/events.jsonl` 或 `.feng/artifacts/`。

## 6. 已修改内容

已修改：

```text
docs/core-requirements.md
docs/architecture.md
```

修改集中在：

```text
Context 必须 token efficient
LLM Message List 必须围绕缓存编排
Loop 和上下文工程
LLM 和缓存
```

## 7. 不建议修改

不建议新增：

```text
prompt DSL
复杂 context planner
复杂 RAG 系统
复杂工具市场
每种 provider 一套独立 prompt
```

feng 的原则仍然是小 kernel 和文件化 self。
