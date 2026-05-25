# Claude Code 借鉴 Review 第 3 轮改进方案

## 问题

MVP 文档里残留了过于具体的 feng 自举示例。它们不是逻辑错误，但会诱导实现者把自举能力预置。

## 修复

修改 `docs/mvp-self-iteration-design.md`：

```text
删除“读取需求、审查文档、编辑 self、修复 candidate”等固定 skill 示例。
删除“架构 review 是否 case-first”这种当前任务专用 eval 示例。
删除“git helper/doc checker”这种过于贴近当前文档工作的工具名。
```

替换为：

```text
适合当前目标的 candidate skill
当前项目声明的业务 eval
领域工具或辅助检查工具
```

## 验收

修改后，MVP 文档只表达通用机制，不再出现一组像模板能力的自举 skill。
