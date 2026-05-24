# 目标 Agent：Coding Agent

## 用户期望

创造者希望用 feng 孵化出一个本地代码助手，例如 `coder`。

使用者期望它像普通命令一样运行：

```text
coder "修复这个测试失败"
coder review
coder explain src/main.ts
```

## 面对的世界

`coder` 面对的是一个软件项目 workspace：

```text
源代码
测试
构建脚本
依赖配置
Git 状态
错误日志
```

## 期望能力

1. 理解项目结构。
2. 阅读和修改代码。
3. 运行测试和构建命令。
4. 根据失败日志定位问题。
5. 生成小而可审查的代码变更。
6. 给出变更摘要和验证结果。

## 期望权限

```text
读取项目文件
写入项目文件
运行受限命令，例如 test/build/lint
读取 Git diff/status
```

高风险命令需要确认，例如删除文件、重写 Git 历史、安装全局依赖。

## 期望接口

```text
coder "任务描述"
coder review
coder test
coder --dry-run "任务描述"
```

## 验收方式

1. 能在一个示例项目中修复简单测试失败。
2. 能解释修改了哪些文件。
3. 能运行验证命令并报告结果。
4. 不在未经确认时执行高风险命令。

