# 目标 Agent：Feng 自举

## 用户期望

创造者希望 feng 可以用自己的机制迭代 feng 自己。

这不是孵化一个新命令，而是验证：

```text
feng grow "让 feng 更好地校准自己的架构、代码和验证方式"
feng check
feng hatch --name feng --portable
```

最终产物仍然是一个名为 `feng` 的 portable 命令。它应该能在另一台机器上创建 workspace、继续 grow、check、hatch。

## 面对的世界

自举时，feng 面对的是 feng 项目本身：

```text
核心诉求文档
架构设计文档
目标 agent 样本
架构评审轮次
源码和测试
构建脚本
Git 历史
```

## 期望能力

1. 理解 feng 的核心诉求。
2. 阅读和推演架构文档。
3. 基于多个目标 agent 做生命周期推演。
4. 识别架构是否过拟合、是否复杂化、是否偏离初衷。
5. 生成改进文档。
6. 修改架构文档、规格文档或源码。
7. 运行检查并提交 Git checkpoint。
8. 在 validated commit 上 hatch 出下一版 `feng`。

## 期望权限

```text
读取 feng 仓库
写入 docs、specs 和未来源码
读取 Git 状态和 diff
运行受限检查命令
创建 Git commit 和 tag
生成 portable package
```

不得默认推送远程仓库、重写 Git 历史、删除评审轮次记录。

## 期望接口

自举 case 不引入新命令名。它使用 feng 的正常创造者接口：

```text
feng grow "..."
feng check
feng hatch --name feng --portable
feng status
feng artifacts
```

## 验收方式

1. 能读取核心诉求和当前架构，生成客观推演报告。
2. 能基于推演报告生成结构性改进建议，而不是为单个 case 打补丁。
3. 能修改架构文档并保留轮次记录。
4. 能使用 Git 提交每轮结果。
5. 能 hatch 出一个名为 `feng` 的 portable 命令。
6. 新的 `feng` 能在干净机器上继续创建、成长、检查和孵化 workspace。
7. 不在未经确认时重写历史、推送远程仓库或删除已有评审材料。
