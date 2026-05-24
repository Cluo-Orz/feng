# 第 12 轮改进文档

## 1. 总体判断

第 11 轮按 case 展开后，暴露出一个跨 case 的共同问题：

```text
active tool pack 在架构文档中出现了，但选择规则不够明确。
```

这会影响：

```text
R03 自造工具
R04 Token Efficiency
R06 Message 编排
R09 初始工具
R18 权限
R20 简单性
```

## 2. 改进内容

已修改 `docs/architecture.md` 两处：

```text
Message List / provider tools
Grow、Check、Tool Growth
```

新增规则：

```text
bootstrap tools 常驻。
领域工具由当前 hook/skill 选择。
工具多时只暴露本轮需要的工具 schema。
工具说明全文留在 tools/ 文件中，必要时再读取。
每次 tool call 仍必须经过 permission check。
```

## 3. 为什么这不是复杂化

这不是新增 tool router。

它只是一个编排原则：

```text
hook/skill 已经存在。
active tool pack 只是从当前 hook/skill 取工具集合。
```

因此没有增加新的架构对象，也没有引入插件市场或复杂调度器。

## 4. 为什么必须写进架构

每个 case 都依赖这个规则：

```text
coding 不应看到 API/小车工具。
api testing 不应每轮暴露所有 HTTP/报告工具。
news 摘要阶段不应暴露抓取工具。
carbrain 不应每轮暴露所有高风险控制工具。
deskhelper find 不应暴露移动/删除工具。
ccmanage 默认不应暴露业务代码写入工具。
feng 自举不能让所有工具 schema 挤爆 context。
```

这是跨 case 的结构性原则，应该进入架构文档。

## 5. 本轮结论

已修改架构文档。

修改保持简单，并且增强 token efficiency 和权限边界。
