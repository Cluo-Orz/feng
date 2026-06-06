# Domain Model & Contracts Development Review

本文记录 `Domain Model & Contracts` 模块完成后的开发 review。

## 重新阅读的材料

```text
docs/detailed-design/top-level-module-design.md
docs/detailed-design/modules/domain-model-contracts/spec.md
opencode/packages/core/src/schema.ts
opencode/packages/core/src/project.ts
opencode/packages/core/src/location.ts
hermes-agent/apps/shared/src/json-rpc-gateway.ts
src/domain/*
tests/domain/domain.test.ts
```

## 顶层视角判断

当前实现符合顶层模块设计：

```text
Domain Model & Contracts 是最低依赖模块。
它没有 import 任何 feng 业务模块。
它只提供共享领域语言、状态、Ref、Result/Error、来源、版本、审计和 summary 类型。
它不读写文件，不追加事件，不调用 LLM，不执行工具，不判断 readiness，不构建 hatch package。
```

实现没有引入 session 作为用户心智概念。测试也检查导出 key 中不存在 session。

## 局部实现判断

实现采用轻量 TypeScript branded type，而不是引入 effect/schema。

这个取舍来自参考项目阅读：

```text
opencode 的 Schema.brand/Newtype 证明 branded id 和 typed summary 有价值。
opencode 的 schema/effect 栈很成熟，但会让 feng 的最低依赖模块过重。
Hermes 的 shared 类型更轻，但没有 branded id 级别约束。
```

当前实现先采用轻量品牌类型、literal tuple 状态集合和 Result helper。后续边界模块需要 runtime decode 时，可以在 File-Native Store、Event Ledger 或 Artifact Registry 层引入 schema，不需要污染 Domain 最底层。

## 修正记录

review 后修正了两个问题：

```text
移除公开 asBrand，避免调用方绕过非空 id factory。
移除 contracts.ts 中未使用的 RuntimeContractId import。
```

同时将 Vitest 测试范围限定为 feng 自己的 `tests/**/*.test.ts`，避免参考项目测试被根项目误收集。

## 验证结果

```text
npm run typecheck
  passed

npm run test:coverage
  passed
  tests: 10 passed
  statements: 100%
  branches: 81.48%
  functions: 100%
  lines: 100%

npm run build
  passed
```

业务代码文件行数检查：

```text
src/ 和 tests/ 下没有超过 400 行的文件。
```

## 是否需要调整详细设计

不需要调整详细设计。

实现中唯一实质性取舍是“不在 Domain 模块引入 runtime schema”。这与 spec 的开放问题一致，也符合最低依赖模块的边界。后续如果 Event Ledger 或 Artifact Registry 需要 schema decode，应在对应模块设计和实现中处理。

## 结论

`Domain Model & Contracts` 可以作为第一阶段已完成模块提交。

