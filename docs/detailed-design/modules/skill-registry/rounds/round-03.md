# Skill Registry Spec Round 03

## 当前草稿判断

第三版已经能作为 Skill Registry 的最终边界，但默认 feedback router skill 仍需明确。

用户要求多层循环的闭环未来必须以 skill 方式存在于 feng 自己迭代过程中，并且 feng -> xiaoshuo 的上报过程应作为通用 skill 默认沉淀下来，但可以被修改。

这要求它既是默认能力，又不能成为自动污染上游的通道。

## 顶层视角检测

系统概要设计的关键约束是：

```text
默认反馈路由 skill 是通用能力，但基础协议稳定，场景策略可 grow。
反馈上报只能成为候选，不能无脑向上游吸收。
每一层都必须有反馈归因和采纳边界。
skill 变更需要版本、来源、证据和回滚边界。
```

小说场景进一步说明：

```text
libai 的作品原文默认属于作品项目。
xiaoshuo 吸收小说创作能力问题。
feng 只吸收系统性 grow/hatch/feedback/skill 问题。
feedback router skill 泄漏作品原文是系统性问题，但作品原文不应默认流到 feng。
```

## 问题

默认 feedback router skill 有两个相反风险：

```text
太弱：只是文档说明，无法沉淀为 feng 默认能力。
太强：直接处理反馈状态、上报内容和上游合并，绕过 Admission、Policy 和 Evidence。
```

它必须停在“策略和协议贡献”这一层。

## 调整

最终 spec 规定：

```text
Skill Registry 必须登记一个 default_feedback_router skill family。
该 family 分为 stable protocol contract 和 versioned scenario strategy。
stable protocol contract 由 Runtime Contract Registry / Admission 等后续模块使用，但本模块只保存引用和版本关系。
scenario strategy 可以 grow、禁用、pin、rollback。
任何 default_feedback_router 版本变更都有 evidenceRef、source、audit 和 rollbackTarget。
该 skill 只能产生路由建议或策略说明，不直接改写 feedback status。
```

反馈状态仍属于 Admission & Feedback Inbox，上游是否吸收仍由对应 grow 层基于证据判断。

## 进入下一轮的结论

本模块可以进入最终 spec。

最终 spec 必须保留这些硬约束：

```text
Skill Registry 不自动注入 prompt。
Skill Registry 不执行工具或 skill 脚本。
Skill activation 需要 policy decision。
Skill body 是 artifact，不是内联事实。
默认 feedback router skill 默认存在、可演进、可回滚，但不能绕过反馈准入。
```
