# MVP Review 第 5 轮改进文档

## 1. Git 推进权

问题：

```text
MVP 需要让 agent 用 Git 修复自己。
但如果把 git commit/tag 暴露成普通 run_command，就会把版本推进权交给一次 LLM tool call。
```

改进：

```text
LLM 可以读 git status/diff/log。
LLM 根据 Git 报告和失败 artifact 修复 working tree。
validated commit、checkpoint commit、hatch tag 由 kernel 在 check/hatch 通过后执行。
```

这个设计保留了“agent 用 Git 修复自己”的能力，同时避免隐藏强制回滚和随机推进版本。

## 2. Provider Profile 位置

问题：

```text
MVP 需要 DeepSeek/OpenAI-compatible 配置。
但 provider profile 不能进入 self repo，否则 hatch package 可能带走本机配置。
```

改进：

```text
provider profile 来自用户级配置、显式路径或 .feng 下未跟踪配置。
真实 key 只通过 env 或本机 secret 管理。
self repo 只包含 config.schema.yaml 和 provider example。
```

## 3. 文档修正

修正：

```text
未来源码 -> 源码
```

## 4. 简单性判断

没有新增 Git service、provider service 或自举 runtime。MVP 仍然是：

```text
Runtime Kernel + Self Repo + .feng State + Git
```
