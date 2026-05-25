# Claude Code 借鉴 Review 第 1 轮改进方案

## 1. 不改方向

以下设计保持不变：

```text
feng grow/check/hatch
单一 loop
白板起点
默认 skills/ 为空
初始四工具
self repo + .feng state + Git
失败 candidate 不强制回滚
hatch 输出命名命令
```

这些已经符合核心诉求，不需要因为 Claude Code 的复杂机制而膨胀。

## 2. 需要 native 化的 Claude Code 经验

### 2.1 Skill 两级加载

把当前“skill-ready context assembly”写得更具体：

```text
skill index 进入稳定前缀
完整 skill 内容只在相关时进入 cached context pack 或动态后缀
skills/ 为空时 index 为空，不伪造能力
```

### 2.2 Context 压缩顺序

补充最小顺序：

```text
长 tool result 先 artifact 化
旧 tool result 占位
历史摘要
低相关 skill/world 出局
reactive compact
仍失败则 blocked
```

### 2.3 LLM 错误恢复

补充 grow loop 中的恢复状态：

```text
max_tokens -> 首次提高输出预算或续写
prompt_too_long -> reactive compact 后重试
429/500/503 -> 退避重试
401/402/missing_config -> blocked
所有恢复写 events/artifacts
```

### 2.4 Active Tool Pack 和缓存

补充：

```text
tool registry 是全集
active tool pack 是本轮暴露给 LLM 的子集
cache key 包含 active_tool_pack_hash
tool growth 或 provider capability 变化会刷新 hash
```

### 2.5 模块详细设计

新增 `docs/mvp-modules/`：

```text
kernel-and-loop.md
self-repo-and-bootstrap.md
message-context.md
llm-provider.md
tools-permissions.md
state-artifacts-git.md
check-hatch-cli.md
```

这些模块必须保持小，不引入多 agent、cron、MCP 完整实现、复杂长期记忆。

## 3. 不进入 MVP 的内容

```text
多 agent team
cron scheduler
MCP transport/OAuth
worktree 并行候选
durable task graph
复杂 memory/dream
后台任务完整生命周期
```

这些可以作为 grow 后的能力，不作为自迭代 MVP 的前提。

## 4. 本轮文档修改

1. 修改 `architecture.md`：补充 skill 两级加载、context pressure/recovery、tool registry/cache hash。
2. 修改 `mvp-self-iteration-design.md`：补充 long-task recovery、module design 入口、active tool pack hash、skill catalog/load。
3. 修改 `llm-provider-research.md`：补充 provider-neutral recovery 和 message/cache 编排约束。
4. 新增 `docs/mvp-modules/*.md`：把 MVP 实现边界写清楚，防止实现时写 feng 专用逻辑。

## 5. Review 标准

修改后重新检查：

```text
是否重新引入预置项目 skill
是否增加第二套 loop
是否把 Claude Code 复杂机制硬搬进 MVP
是否能解释 feng 自迭代如何靠通用逻辑跑通
是否能保证 token efficiency 和 cache hit
```
