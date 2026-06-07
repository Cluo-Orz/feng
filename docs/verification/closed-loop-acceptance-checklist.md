# 概念闭环验收清单 (acceptance checklist)

> 来源：docs/product-concept.md(199-211), docs/feng-novel-case-flow.md(157-290)。
> 本清单是"概念闭环是否真正达成"的判据，不是单测是否通过的判据。

## 断点诊断（接手时状态）
- `feng write` 是 host-level 命令，直接用 `src/host/prompts.ts` 硬编码 prompt 调 DeepSeek；**没有**加载 xiaoshuo hatch 出的运行包。→ 违反概念 199（"不能只是 prompt 加命令包装"）。
- `F:\code\xiaoshuo` 的 grow unit 停在 `intake`，agenda/DoD 为空，attempt 为 `completed_no_tool_calls`。→ xiaoshuo 不是被 grow 出来的 agent。
- `F:\code\libai-chongsheng\.feng` 只有 novel-state/artifact/ledger，**没有** runtime message list / trace / quality eval / 作品级 feedback candidate。
- libai 三章有真实质量硬伤：字数超界(1892/2004/1776 vs 900-1500)、年份 2024→2025、人物承接断裂(女孩→杨慎之)、地理冲突(成都/采石矶)。→ "能写"但未证明"写得好且可验证"。

## 验收项（每项必须有现场文件证据，不能只靠 review 文档声明）

### A. xiaoshuo 层（F:\code\xiaoshuo）—— 真实 grow 出小说 agent
- [ ] A1 目标世界定义（输入/输出/动作/失败契约）作为文件存在。
- [ ] A2 上下文策略（区分作品事实/当前章节/长期写作策略/反馈候选）写入运行契约。
- [ ] A3 写作策略（系统提示+约束）由 grow（LLM attempt）产生并作为 evidence 落盘，**不是** feng 内部硬编码。
- [ ] A4 质量 DoD（字数、年份、人物承接、地理、章节连续、风格）写入契约。
- [ ] A5 feedback routing 策略（作品级→libai / 能力级→xiaoshuo / 系统级→feng）写入契约。
- [ ] A6 readiness 判定 + hatch 出可复制运行包文件（version 锁定）。

### B. 运行包（hatched runtime package）
- [ ] B1 运行包是单一 file-native 工件，携带：运行入口、接入契约、message-list 编译方式、上下文策略、trace/feedback 能力、本地吸收/上游提议边界、验证报告、版本。
- [ ] B2 运行包可被 `cp` 到另一目录（libai）并被加载。

### C. libai 层（F:\code\libai-chongsheng）—— 使用 hatched runtime
- [ ] C1 运行加载的是 hatched xiaoshuo 运行包，**不是** feng 的 prompts.ts。
- [ ] C2 每章 file-native：本轮输入、编译后的 message list、模型输出、章节文件、novel-state、trace、quality eval、feedback candidate。
- [ ] C3 trace 记录：本轮输入/使用的作品事实/使用的写作策略/生成文本/发现的冲突/反馈候选。

### D. 质量与反馈
- [ ] D1 deterministic 质量检查能抓到真实问题：字数、章节编号连续、年份一致、人物承接、地点一致、outline 连续、文件/trace/message-list 存在。
- [ ] D2 每条问题归因到正确层级（作品事实→libai；写作能力→xiaoshuo；系统→feng），写成 file-native feedback candidate。
- [ ] D3 反馈不无脑上游吸收：作品事实留 libai，只有系统性问题进 feng。

### E. 端到端
- [ ] E1 从空/半空 xiaoshuo grow→hatch。
- [ ] E2 在 libai 写≥3章。
- [ ] E3 质量检查抓到真实问题。
- [ ] E4 feedback candidate 进入正确层级。
- [ ] E5 修复/再 grow 后重跑，质量改善可见。

## 测试边界
- 单测 deterministic，用 fake fetch / fixture，不依赖真实 LLM。
- LLM 现场验证作为 manual/live，不作为唯一测试。
- 质量测试两层：结构化 deterministic（必做）+ 可选 LLM 语义 eval（结果落盘成 eval artifact）。
- "模型生成了一章" ≠ 质量通过；"review 文档声称通过" ≠ 通过（必须查现场文件）。
- 不破坏现有 typecheck/build/coverage；业务文件≤400 行；功能不打折。

## 诚实修正
- `docs/development-reviews/cross-instance-supervision.md` 的 live 证据写在临时 supervisor 工作区（已删除），在 `F:\code\feng` 无持久证据。需修正措辞并改为可复现的持久目录证据。
