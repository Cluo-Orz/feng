# Claude Code 借鉴 Review 第 3 轮：架构 Case 推演

本轮从顶层检查“是否仍在用 feng 自举样例牵引设计”。结论：主架构方向稳定，但 MVP 主文档有少量例子仍像预设 feng 自举 skill。

## 七个 case 复核

### Coding Agent

应该由目标、源码、测试和用户反馈长出代码相关 skill，而不是继承一组文档 review skill。

状态：主架构满足；MVP 示例语句可能误导实现。

### API Testing Agent

应该长出 API schema、HTTP、mock、report 相关能力。

状态：主架构满足；不依赖固定 self-edit skill。

### News Summary Agent

应该长出 source、dedupe、citation、freshness 相关能力。

状态：主架构满足；不依赖固定 review skill。

### Robot Car Agent

应该长出 sensor、control、safety、simulation 相关能力。

状态：主架构满足；不依赖固定 doc checker。

### Windows Desktop Assistant

应该长出 file organize、dry-run、PowerShell permission 相关能力。

状态：主架构满足；不依赖固定 repair skill。

### Claude Code Session Manager

应该长出 session summary、handoff、diff 相关能力。

状态：主架构满足；不依赖固定 architecture-review skill。

### Feng 自举

feng 自举也应该只通过目标和当前仓库感知，生成本轮需要的 candidate skill/eval/tool，而不是模板预设“读需求、审查文档、编辑 self、修复 candidate”。

状态：需要修 MVP 主文档的示例表达。

## 本轮结论

需要删除主 MVP 文档中看起来像固定 self skill 的例子，把它改成：

```text
第一个 grow 可以创建适合当前目标的 candidate skill。
```

这不是语义洁癖。它直接影响实现者是否会把这组能力写进 template 或 runtime。
