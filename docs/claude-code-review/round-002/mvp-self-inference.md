# Claude Code 借鉴 Review 第 2 轮：MVP 自迭代推演

## 1. 当前自迭代路径

MVP 自迭代仍然走通用路径：

```text
feng grow "改进 feng 自己"
  -> bootstrap 或读取 workspace
  -> seed loop
  -> 修改 candidate
  -> check
  -> repair 或 validated
  -> hatch --name feng --portable
```

没有发现新预置 skill、feng 项目名分支或自举专用 runtime。

## 2. 第一轮改动带来的改善

```text
skill catalog/body 两级加载更明确。
active tool pack 与 prompt cache 绑定更明确。
LLM recovery 进入 architecture/MVP/LLM 文档。
新增 mvp-modules，降低实现时硬编码自举逻辑的风险。
```

## 3. 新发现的问题

MVP 主文档中 `.feng/state.yaml` 的 mode 仍是：

```text
mode: growing | checking | blocked | ready
```

但同一文档后面写：

```text
401 / 402 / missing_config -> mode: missing_config 或 blocked
feng status 显示 missing_config
```

模块文档也写：

```text
mode: growing | checking | blocked | ready | missing_config
```

这是跨文档不一致。

另一个问题是 state 主文档没有记录：

```text
active_tool_pack_hash
stable_prefix_hash
dynamic_suffix_tokens
last_recovery
recovery_count
```

这些字段不是为了复杂化，而是为了让长任务稳定和 token efficiency 可观测。没有这些字段，`feng status` 只能看到粗粒度状态，无法解释为什么 blocked 或 cache miss。

## 4. 本轮修复判断

需要修：

```text
docs/mvp-self-iteration-design.md
docs/mvp-modules/state-artifacts-git.md
```

不需要修：

```text
architecture.md
llm-provider-research.md
```

因为它们的概念已经一致，问题集中在 MVP state schema。
