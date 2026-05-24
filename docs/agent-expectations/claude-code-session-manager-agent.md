# 目标 Agent：Claude Code 会话管理 Agent

## 用户期望

创造者希望用 feng 孵化出一个 Claude Code 会话管理命令，例如 `ccmanage`。

使用者期望：

```text
ccmanage list
ccmanage summarize current
ccmanage handoff --to next-session.md
```

## 面对的世界

`ccmanage` 面对的是本地 Claude Code 相关工作记录：

```text
项目目录
会话摘要
任务计划
变更 diff
命令输出
待办事项
handoff 文档
```

## 期望能力

1. 整理当前 coding 会话状态。
2. 提取已完成事项、未完成事项和阻塞点。
3. 生成 handoff 文档。
4. 对比 Git diff 和任务目标。
5. 帮助用户恢复上下文。

## 期望权限

```text
读取项目文件和 Git 状态
写入 handoff 文档
读取本地会话记录目录
```

不得修改代码，除非用户明确授权。

## 期望接口

```text
ccmanage summarize
ccmanage handoff
ccmanage status
ccmanage next
```

## 验收方式

1. 能从示例项目状态生成准确 handoff。
2. 能区分已完成、未完成和风险。
3. 能引用关键文件和 Git diff。
4. 默认不修改业务代码。

