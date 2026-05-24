# MVP Review 第 3 轮改进文档

## 1. 问题

Hatch 章节没有明确新机器首次运行时的 provider 配置引导。

## 2. 修改建议

补充：

```text
hatch package 可以包含 provider example。
不能包含真实 provider profile。
不能包含 API key。
首次运行缺配置时进入 missing_config。
grow 不启动 LLM。
status 显示需要的 provider 和 env。
```

## 3. 为什么需要

MVP 目标要求 hatch 出来的 feng 能在另一台机器继续 grow/check/hatch。

但 LLM provider 是运行必要条件。没有配置引导，产物虽然能启动 CLI，却不能自迭代。

## 4. 不复杂化理由

这只是 config.schema.yaml 和 status 行为，不需要 provider 管理平台。
