# 第 13 轮改进文档

## 1. 总体判断

第 13 轮 case-first 推演发现：

```text
artifact ref 不能只有路径、hash、摘要。
```

因为每个 case 都需要判断 artifact 的类型、来源以及为什么和当前任务相关。

## 2. 已修改内容

已修改：

```text
docs/core-requirements.md
docs/architecture.md
```

把 artifact ref 表达从：

```text
路径、hash、摘要、必要片段
```

补强为：

```text
类型、来源、路径、hash、摘要、为什么相关、必要片段
```

## 3. 为什么这是架构概念

这不是具体文件格式。

这是 context engineering 的边界：

```text
大内容不进入 prompt。
但 prompt 里的引用必须足够让 LLM 判断是否需要读取原文。
```

如果没有 `type/source/why_relevant`，agent 会频繁 read_file，或者误读错误 artifact。

## 4. 为什么没有复杂化

没有新增：

```text
artifact 数据库
RAG 系统
索引服务
检索模型
```

只是在 message list 的 artifact refs 里明确最小语义。

## 5. 本轮结论

修改合理。

它加强了：

```text
R04 Token Efficiency
R06 Message 编排
R13 Reload / Repair
R16 可观测性
```
