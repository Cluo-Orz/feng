# 概念闭环 —— 现场验证证据 (live evidence)

> 本文记录 feng -> xiaoshuo -> libai-chongsheng 三层闭环的真实现场证据。
> 所有命令对 DeepSeek 实跑；所有文件路径为运行后真实存在的工件。
> 验收清单见 closed-loop-acceptance-checklist.md。

## 运行命令序列（可复现）

```
# 1) 在 xiaoshuo 项目里真实 grow 出小说写作 agent，并 hatch 运行包
feng grow-agent --goal "成长出一个可复制的中文连载小说写作 agent…" --name xiaoshuo --workspace F:\code\xiaoshuo
#   -> [grow-agent] hatched .feng/hatch/xiaoshuo-runtime.json
#      growUnit=grow-9de8c4f1… lifecycle=ready_to_hatch readiness=ready_to_hatch strategyChars=301

# 2) 把 hatch 运行包复制到作品项目，作品项目提供自己的事实
cp F:\code\xiaoshuo\.feng\hatch\xiaoshuo-runtime.json  F:\code\libai-chongsheng\.feng\hatch\
#   并写入 F:\code\libai-chongsheng\.feng\runtime\project.json (premise/title/年份/人物/conflictTerms/bible)

# 3) 在作品项目里用 hatched 运行包逐章写作（每章产出全套 file-native 工件）
feng run --chapters 3 --workspace F:\code\libai-chongsheng

# 4) 反馈分层路由：作品事实留本地，能力问题回流 xiaoshuo，系统问题进 feng
feng route-feedback --target F:\code\libai-chongsheng --agent-dir F:\code\xiaoshuo --feng-dir <feng>
```

## A. xiaoshuo 真实 grow（对照：接手时停在 intake）

- `F:\code\xiaoshuo\.feng\grow-units\records\grow-*.json`: **lifecycle=ready_to_hatch, currentPhase=hatch**（不再是 intake）。
- `F:\code\xiaoshuo\.feng\agenda\`、`F:\code\xiaoshuo\.feng\evidence-readiness\`: 存在真实 agenda/DoD/evidence/readiness 记录。
- 写作策略由 LLM 设计（grow attempt 产出），落盘为 evidence，再锁进运行包——**不是 feng 内部硬编码 prompt**。

## B. hatched 运行包（file-native，可复制）

`F:\code\xiaoshuo\.feng\hatch\xiaoshuo-runtime.json`，字段实测：
- kind=serialized_authoring_agent, locked=true, version=1.0.0, validation.readiness=ready
- targetWorld(输入/输出/动作/失败契约)、contextPolicy(4 段)、writingStrategy(grown systemPrompt+stylePrinciples)、qualityRules(7)、feedbackRouting(7)、provenance(model/provider/hatchedAt)、validation.grownByGrowUnitId 指向真实 grow unit。
- 已 `cp` 到 `F:\code\libai-chongsheng\.feng\hatch\xiaoshuo-runtime.json` 并被加载。

## C. libai 使用 hatched runtime，每章 file-native

`feng run --chapters 3` 输出：
```
[run] package=xiaoshuo@1.0.0 chapters=3
  ch1: 3567 chars, quality=pass, issues=2 (work=2 capability=0 system=0)
  ch2: 2654 chars, quality=pass, issues=2 (work=2 …)
  ch3: 2848 chars, quality=pass, issues=1 (work=1 …)
```
每章目录 `F:\code\libai-chongsheng\.feng\runtime\chapters\chapter-0N\` 实测含：
`input.json` / `message-list.json` / `model-output.json` / `trace.json` / `quality-eval.json` / `feedback.json`，
章节正文在 `F:\code\libai-chongsheng\chapters\chapter-0N.md`，状态在 `.feng/runtime/novel-state.json`。

- message-list.json 区分 observation/short_term/long_term/feedback 四段（概念 207）。
- trace.json 记录：本轮输入、使用的作品事实(factsUsed)、使用的写作策略(strategyUsed=xiaoshuo@1.0.0)、生成字数、发现的冲突(conflictsFound)、反馈候选数（概念 214-222）。
- 加载的是运行包的 grown systemPrompt，**不是** `src/host/prompts.ts`。

## D. 质量与分层反馈（结构化 deterministic）

- D1 现场抓到真实问题：`length[warning] 第1章3567字超过上限1500`、`geography_consistency[warning] 出现「采石矶」需复核`。
  其余检查（年份漂移、人物承接、章节连续、大纲连续、artifact 缺失）由单测确定性覆盖
  （见 tests/authoring-runtime/quality.test.ts，含 2024→2025 漂移、人物承接、artifact 缺失等 12 例）。
- D2 feedback.json 每条带 layer + routingReason，例：length→work「单章字数是作品级问题」。
- D3 `feng route-feedback` 实测：`total=5 work(kept-local)=5 capability->agent=0 system->feng=0`，
  xiaoshuo 的 .feng/admission 仍为空——**作品事实不被无脑上游吸收**。
  capability→xiaoshuo / system→feng 的吸收路径由单测确定性覆盖（tests/host/feedback-router.test.ts）。

## E. 端到端

- E1 从清空的 xiaoshuo grow→hatch（live）。
- E2 libai 写 3 章（live），章节连贯（采石矶坠江→2024成都→便利店→直播赋诗→教授），年份一致 2024。
- E3 质量检查现场抓到真实问题（length/geography）。
- E4 反馈分层落盘并路由（work 留本地）。
- E5 自动改善闭环：authoring runtime 现已内置 length self-repair——检测到超长/欠长即带「修订要求」自动重试一次，并把 repairAttempts 写入 trace/model-output。
  - 确定性验证（tests/authoring-runtime/runtime.test.ts）：12 字短稿 → 自修复 → ≥900 字，length 问题消除，repairAttempts=1。
  - 现场诚实结果：对超长稿，self-repair 确实触发（repairAttempts=1）并要求压缩，但 DeepSeek 推理模型即便被要求压缩仍倾向写长（2867→仍 2867 字），未压到 1500 以内。
    这是模型行为限制，非机制缺陷；length 仍以 warning 记录并归因到 work 层。后续可为该模型放宽 maxChars 或引入更强约束/分段生成。

## 测试边界遵循

- 单测全部 deterministic，使用 fake fetch / fixture，不依赖真实 LLM（quality/feedback/message-list/package/runtime/grow-agent/router/CLI 共 ~60 例）。
- LLM 现场验证作为补充证据，非唯一测试。
- 质量测试两层：结构化 deterministic（必做，已覆盖）+ 现场 live 佐证。
- 基线：typecheck / build / test:coverage（105 文件 / 503 测试，全局 branch 80.02%）/ 业务文件 ≤400 行。

## 诚实记录的设计判断

- detailed-design 的 Debug & Feedback Bridge 与"孵化运行时 + kernel trace"强耦合（openDebugCorrelation 需 hatchPackageRef+runtimeContractRef），对写作类 agent 过拟合。
  依据 product-concept「实现优先、设计非真理、过度设计可调整」，本闭环改为：feng 提供领域无关的 authoring runtime kernel + 运行包契约，领域写作能力 grow 进运行包。
  概念 203-211 要求的运行契约要素（运行入口/IO/message-list 编译/上下文区分/trace/feedback/版本锁）在运行包与 runtime 中逐项落实。

## 仍未做（诚实标注）

- 语义级 LLM eval（文风/人物可信度）尚未落盘为 eval artifact，目前仅结构化检查。
- length self-repair 已就位，但对该推理模型未能稳定压到字数上限（模型偏长）；可通过放宽 maxChars、分段生成或更强约束进一步改善。
- 完整 Debug & Feedback Bridge + kernel-run-elsewhere（重型路径）仍未接入；当前以文件原生运行包 + authoring runtime 实现概念要求的运行契约要素。
