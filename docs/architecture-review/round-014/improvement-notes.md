# 第 14 轮改进文档

## 1. 问题一：起点语义不纯

`new/init-self` 的问题不是命令名不好听，而是把“孵化开始”拆成了多个工程动作。

改进：

```text
公开主路径只保留 grow / check / hatch。
第一次 grow 可以 bootstrap。
bootstrap 是 grow 的前置阶段，不是产品命令。
```

涉及文档：

```text
docs/core-requirements.md
docs/architecture.md
docs/mvp-self-iteration-design.md
docs/architecture-review/review-method.md
docs/mvp-self-iteration-review/review-method.md
```

## 2. 问题二：已有目录的处理不清楚

feng 自举和 coding agent 都可能在已有仓库中启动。如果 bootstrap 被理解成“创建新项目”，就会和用户已有文件冲突。

改进：

```text
bootstrap 只补齐缺失的 self 文件和 .feng 状态。
不覆盖已有 docs/src/tests/脚本/配置。
已有项目内容先作为 world 或可感知目标。
```

## 3. 问题三：Git 感知方式不够明确

用户希望 agent 能用 Git 修复自己，但强制回滚不是默认逻辑。

改进：

```text
Git 是成长账本。
kernel 把 status/diff/check report/validated commit 写入 state/artifacts。
agent 可通过 permissions 允许的 git 命令查看事实。
修复 candidate 的默认方式是继续编辑 working tree。
validated self 只是运行基线，不是自动 reset。
```

## 4. 问题四：provider 示例不应过度绑定未来模型名

MVP 文档里 provider profile 不应把一个可能变化的模型名写成核心设计。

改进：

```text
DeepSeek profile 使用 model_env。
example_model 只作为示例。
真实 key 和本机 profile 不进入 self、Git、artifact 或 hatch package。
```

## 5. 不做的事

本轮没有新增：

```text
bootstrap 子系统
Git repair 服务
模板市场
自举专用命令
provider router
```

所有修改仍回到四个核心对象：

```text
Runtime Kernel + Self Repo + .feng State + Git
```
