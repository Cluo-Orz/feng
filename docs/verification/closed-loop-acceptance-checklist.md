# 概念闭环验收清单 (acceptance checklist)

> 来源：docs/product-concept.md(199-211), docs/feng-novel-case-flow.md(157-290)。
> 本清单是"概念闭环是否真正达成"的判据，不是单测是否通过的判据。

## 断点诊断（接手时状态）
- `feng write` 是 host-level 命令，直接用 `src/host/prompts.ts` 硬编码 prompt 调 DeepSeek；**没有**加载 xiaoshuo hatch 出的运行包。→ 违反概念 199（"不能只是 prompt 加命令包装"）。
- `F:\code\xiaoshuo` 的 grow unit 停在 `intake`，agenda/DoD 为空，attempt 为 `completed_no_tool_calls`。→ xiaoshuo 不是被 grow 出来的 agent。
- `F:\code\libai-chongsheng\.feng` 只有 novel-state/artifact/ledger，**没有** runtime message list / trace / quality eval / 作品级 feedback candidate。
- libai 三章有真实质量硬伤：字数超界(1892/2004/1776 vs 900-1500)、年份 2024→2025、人物承接断裂(女孩→杨慎之)、地理冲突(成都/采石矶)。→ "能写"但未证明"写得好且可验证"。

## 验收项（每项必须有现场文件证据，不能只靠 review 文档声明）

> 状态：详见 closed-loop-live-evidence.md（现场命令+文件路径）与各模块单测。

### A. xiaoshuo 层（F:\code\xiaoshuo）—— 真实 grow 出小说 agent
- [x] A1 目标世界定义（输入/输出/动作/失败契约）—— 运行包 targetWorld（live）。
- [x] A2 上下文策略（区分作品事实/当前章节/长期写作策略/反馈候选）—— 运行包 contextPolicy 4 段（live）。
- [x] A3 写作策略由 grow（LLM attempt）产生并落盘为 evidence —— grow-agent designStrategy，非硬编码（live, strategyChars=301）。
- [x] A4 质量 DoD（字数/年份/人物/地理/章节/大纲/artifact）写入运行包 qualityRules（7 条）。
- [x] A5 feedback routing 策略写入运行包 feedbackRouting（7 条，work/capability/system）。
- [x] A6 readiness 判定 + hatch 包；grow unit lifecycle=ready_to_hatch, phase=hatch（live，不再 intake）。

### B. 运行包（hatched runtime package）
- [x] B1 单一 file-native 工件，携带运行入口/契约/message-list 编译/上下文策略/质量/反馈/验证/版本锁。
- [x] B2 可 `cp` 到 libai 并被加载（live）。

### C. libai 层（F:\code\libai-chongsheng）—— 使用 hatched runtime
- [x] C1 加载 hatched 运行包的 grown systemPrompt，非 prompts.ts（live）。
- [x] C2 每章 file-native：input/message-list/model-output/trace/quality-eval/feedback + 章节文件 + novel-state（live）。
- [x] C3 trace 记录输入/作品事实/写作策略/生成/冲突/反馈候选（live）。

### D. 质量与反馈
- [x] D1 deterministic 质量检查抓到真实问题：live 抓到 length/geography；年份/人物/章节/大纲/artifact 由单测覆盖。
- [x] D2 每条问题归因到层级并落盘（feedback.json 带 layer+reason）。
- [x] D3 反馈不无脑上游吸收：route-feedback 实测 work 全留本地（5/5），xiaoshuo admission 为空；capability→xiaoshuo / system→feng 由单测覆盖。

### E. 端到端
- [x] E1 从清空 xiaoshuo grow→hatch（live）。
- [x] E2 libai 写≥3章（live，连贯、年份一致）。
- [x] E3 质量检查抓到真实问题（live）。
- [x] E4 feedback 分层路由（live + 单测）。
- [~] E5 自修复机制就位（length self-repair，单测证明短稿→≥900字改善）；现场对超长稿触发但模型仍偏长，已诚实记录。

## 测试边界
- 单测 deterministic，用 fake fetch / fixture，不依赖真实 LLM。
- LLM 现场验证作为 manual/live，不作为唯一测试。
- 质量测试两层：结构化 deterministic（必做）+ 可选 LLM 语义 eval（结果落盘成 eval artifact）。
- "模型生成了一章" ≠ 质量通过；"review 文档声称通过" ≠ 通过（必须查现场文件）。
- 不破坏现有 typecheck/build/coverage；业务文件≤400 行；功能不打折。

## 诚实修正
- `docs/development-reviews/cross-instance-supervision.md` 的 live 证据写在临时 supervisor 工作区（已删除），在 `F:\code\feng` 无持久证据。需修正措辞并改为可复现的持久目录证据。
