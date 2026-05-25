# Claude Code 借鉴 Review 第 4 轮：MVP 自迭代收敛推演

## 自迭代闭环

```text
feng grow "改进 feng 自己"
  -> seed loop 读取 docs、modules、review artifacts、Git
  -> message compiler 组装 token-efficient messages
  -> LLM 通过四个初始工具行动
  -> candidate 修改形成
  -> check 运行 baseline 和 candidate eval
  -> 失败保留 artifacts 并继续 grow
  -> 成功更新 validated commit
  -> feng hatch --name feng --portable
```

## 通用性复核

```text
无 feng 项目名分支。
无自举专用命令。
无自举专用 prompt 通道。
无预置项目 skill。
默认 template 只补齐 self 形状。
```

## Claude Code 借鉴复核

已 native 化为 feng 机制：

```text
单 loop
hook 是时机
skill 两级加载
context compact/recovery
active tool pack/cache hash
permission boundary
state/events/artifacts
provider error normalization
```

未硬搬进 MVP：

```text
multi-agent team
cron scheduler
MCP transport/OAuth
worktree parallel candidates
complex memory/dream
durable task graph
```

## 收敛判断

MVP 文档现在是架构文档的可实施落地方案。它仍然简化，但关键不变量已经足够清楚，后续可以进入实现规格。
