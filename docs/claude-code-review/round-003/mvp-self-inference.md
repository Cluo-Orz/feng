# Claude Code 借鉴 Review 第 3 轮：MVP 自迭代推演

## 检查点

自迭代要求：

```text
不写自举专用命令
不写自举专用 prompt 通道
不预置项目 skill
不按 feng 项目名分支
```

## 发现

MVP 主文档中有三处示例仍容易被实现成硬编码：

```text
第一个 grow 可以创建读取需求、审查文档、编辑 self、修复 candidate 等 skill
架构 review 是否 case-first
git helper 或 doc checker
```

这些语句本意是举例，但它们和当前 feng 自举任务过于贴近。对于实现者来说，它们会形成“这就是 MVP 必备能力”的错觉。

## 判断

这些内容应该保留抽象语义，删除具体 feng 自举词汇：

```text
当前目标需要的 candidate skill
当前项目声明的业务 eval
后续 grow 出领域工具或辅助检查工具
```

这样仍然能跑通 feng 自举，但不再把 feng 自举当作模板能力。
