# 第 8 轮改进文档

## 1. 总体判断

本轮没有发现需要修改架构文档的结构性问题。

第 7 轮加入的 token efficiency 规则与七个目标 agent 兼容。

## 2. 为什么不继续修改

当前文档已经表达清楚：

```text
稳定内容形成可缓存前缀
动态内容放在后缀
大内容文件化
tool response 长结果文件化
assistant role 不保存长推理
active tool pack 控制工具 schema token
```

如果继续补细节，容易进入实现规格，例如：

```text
artifact 文件命名规则
token 预算百分比
具体 cache TTL
provider 专用 cache_control 字段
具体 endpoint selection 算法
```

这些不应该进入当前架构概念文档。

## 3. 保留的实现期问题

后续实现规格需要回答：

```text
如何估算每个 message 的 token
如何记录 cached tokens
如何决定文件引用是否升级为 cached context pack
如何在 provider adapter 中保持 tool call / tool response 的合法顺序
如何让 active tool pack 在任务阶段内稳定
```

这些问题是实现层，不是当前顶层架构缺口。

## 4. 本轮结论

不修改 `docs/architecture.md`。

建议下一阶段从概念文档切换到最小实现规格，尤其是：

```text
Message 数据结构
ArtifactRef 数据结构
ToolResult 截断规则
ContextBudget 计算规则
Provider adapter 编译规则
```
