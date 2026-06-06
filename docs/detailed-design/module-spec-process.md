# 模块 Spec 编写规则

本文定义 feng 分模块详细设计的写法。所有模块 spec 必须以 SDD 风格描述“完成后的终态事实”，而不是传统详细设计里常见的实现计划、任务拆解或待办列表。

## 文档结构

每个模块使用一个目录维护：

```text
docs/detailed-design/modules/<module-name>/
  spec.md
  rounds/
    index.md
    round-01.md
    round-02.md
    round-03.md
```

如果某个模块特别复杂，可以继续增加 `round-04.md`、`round-05.md`。但最少必须有 3 轮检测与调整。

轮次过程文档必须按文件拆分维护。不要把多个模块或多个 round 合并到一个巨型过程文档中；根目录可以保留索引或指针文档，具体检测、反思、调整内容放入对应目录。

## Spec 写作要求

`spec.md` 只写终态事实：

```text
该模块是什么。
该模块拥有什么职责。
该模块不拥有什么职责。
该模块依赖哪些模块。
哪些模块依赖它。
它导出的 TypeScript 类型、ports 或 service 边界是什么。
它读写哪些 file-native 事实或 artifact。
它产生哪些事件。
它必须维持哪些不变量。
它在错误、版本不兼容、边界失败时如何表现。
它如何被测试或验证。
```

避免写成：

```text
后续需要实现……
计划支持……
可能考虑……
TODO……
第一步、第二步、第三步实现……
```

开放问题可以写，但必须放在独立的“开放问题”小节，并明确它们不影响本模块当前终态事实。

## 三轮检测要求

每个模块 spec 完成前，至少执行 3 轮：

```text
检测 -> 调整
检测 -> 调整
检测 -> 调整
```

每轮检测都要跳出当前模块，从更高层视角检查：

```text
是否符合产品概念。
是否符合系统概要设计。
是否符合顶层模块设计。
是否吸收了 agent 调研中的原则，而不是复制调研对象产品形态。
是否破坏 file-native、无 session、message list 编译产物、反馈候选、hatch contract 等不变量。
是否与已经完成的其他模块 spec 冲突。
是否让用户心智变重。
是否过早进入目录 schema、provider adapter、MCP adapter、eval runner 或实现代码。
```

## Round 文档格式

每个 round 文档推荐使用：

```markdown
# <Module Name> Spec Round NN

## 当前草稿判断
## 顶层视角检测
## 问题
## 调整
## 进入下一轮的结论
```

Round 文档可以记录被拒绝的方案、反思和草稿。`spec.md` 不记录这些过程噪声。

## 模块顺序

按低依赖到高依赖推进：

```text
1. Domain Model & Contracts
2. File-Native Store
3. Event Ledger & Projection
4. Artifact Registry
5. Policy & Capability Boundary
6. Skill Registry
7. Grow Unit Manager
8. Admission & Feedback Inbox
9. Agenda & DoD Manager
10. Context & Message Compiler
11. LLM Gateway
12. Tool Runtime
13. Grow Attempt Runner
14. Evidence & Readiness
15. Runtime Contract Registry
16. Hatch Builder
17. Target World Adapter
18. Agent Runtime Kernel
19. Debug & Feedback Bridge
20. CLI
```

越往后的模块必须读取前面已经完成的模块 spec，并显式说明依赖关系。
