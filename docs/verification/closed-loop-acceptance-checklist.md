# 概念闭环验收清单（诚实状态）

> 状态用 passed / partial / failed 标注，并指向真实证据（代码、单测、现场 .feng 文件）。
> 来源：docs/product-concept.md(199-211)、docs/feng-novel-case-flow.md(157-290)、codex 复核意见。
> 原则：先代码与现场证据，再文档；不提前打勾。

## 历史断点（codex 复核指出，本轮已处理）
1. grow 是 one-shot（designStrategy→hatch），evidence 为 model_self_claim。
2. xiaoshuo 只是生成 prompt，没有 story/context/harness 设计。
3. 质量门太宽：length>max 仅 warning 却 qualityPassed=true。
4. system→feng 无现场证据（system=0）。
5. 文档过度验收（checklist 全 [x]）。

## A. xiaoshuo 真实 grow 出小说 agent
- A1 目标世界契约（输入/输出/动作/失败） — **passed**：运行包 targetWorld。
- A2 上下文策略（observation/short_term/long_term/feedback） — **passed**：contextPolicy + message-list 编译。
- A3 写作策略由 LLM grow，非硬编码 — **passed**：grow-agent designStrategy。
- A4 story/context/harness 模型 — **passed (ITER3)**：运行包 storyModel(premise/world/character/timeline/locations/hooks/outlines + 连贯维度) + harness(run/revise/evaluate/continuity/route/re-grow/re-run)；message-list 把连贯维度编入系统提示。
- A5 多轮 grow（运行样例→反馈→修订→再验证） — **passed (ITER2)**：`feng grow-agent --loop` 多轮；现场 `.feng/grow-samples/round-N/` 有 round-report + 样例章 + eval。
- A6 readiness 来自样例运行证据，非 model_self_claim — **passed (ITER2)**：evidence sourceKind=validation_report（"capability 0→0, hard-fail 0"），现场已核。
- A7 readiness 门槛诚实 — **passed**：仅当最终轮 capability=0 且 hard-fail=0 才 ready/locked，否则 draft。

## B. 运行包
- B1 file-native、契约完整、版本锁 — **passed**：.feng/hatch/xiaoshuo-runtime.json，locked 由 readiness 决定。
- B2 可 cp 到作品项目并加载 — **passed**：libai 加载运行。
- B3 版本锁运行时强制 — **passed**：feng run 拒绝 unlocked 包（production_lock_violation）。

## C. libai 使用 hatched runtime，每章 file-native
- C1 加载 hatched 运行包（非 prompts.ts） — **passed**。
- C2 每章 input/message-list/model-output/trace/quality-eval/feedback(+semantic-eval) — **passed**。
- C3 trace 记录输入/作品事实/策略/冲突/反馈 — **passed**。

## D. 质量与反馈
- D1 结构化质量门诚实（pass/pass_with_warnings/fail） — **passed (ITER1)**：硬性违规=fail；length>max 现在是 error 不是 warning。
- D2 章节修订（失败章原地修复并改善） — **passed (ITER5)**：eval 驱动修订，保留更优稿；单测：年份漂移硬失败→修订通过。
- D3 分层归因 work/capability/system — **passed**：feedback.json 带 layer+reason。
- D4 三路现场吸收 — **passed (ITER4)**：work→local、capability→xiaoshuo、system→F:\code\feng\.feng 均有现场证据。
- D5 system 层真实信号 — **passed (ITER4)**：kernel-contract 检查（dialogueAllowed/unsupported outputKind）产出 runtime_capability→system。
- D6 语义 eval 落盘且不自嗨 — **partial**：semantic-eval.json 已落盘并含 notes；但 judge 目前给整体分+点评，尚未强制结构化输出"问题+证据片段+修复建议"。下一步可加严。

## E. 端到端
- E1 空目录 grow→hatch（多轮） — **passed**：live。
- E2 libai 写≥3章 — **passed**：live，连贯。
- E3 质量门抓真问题 — **passed**：live 抓到 length/geography（work）、character_continuation（capability）、runtime_capability（system）。
- E4 反馈进正确层级 — **passed**：live 三路。
- E5 修复后质量改善 — **partial**：ITER5 章节修订单测证明改善；grow-loop 单测证明 capability 0→减少 + 长度契约校准；但"同一作品反复迭代直至全绿"的长链 live 仍可继续加强。

## 仍未做 / 明确下一步（不打勾）
- semantic judge 强制结构化「问题+证据片段+修复建议」并据此触发修订（D6）。
- 更长的作品级迭代：libai 出现 capability 问题→route 回 xiaoshuo→xiaoshuo 再 grow→re-hatch→libai 重跑→指标改善 的完整 live 闭环（目前各段都有证据，端到端单链 live 可再串一次）。
- 完整 Debug & Feedback Bridge + kernel-run-elsewhere 重型路径（仍以文件原生运行包等价实现运行契约要素）。

## 测试边界
- 单测全 deterministic（fake fetch / fixture），不依赖真实 LLM。
- live 仅作补充证据；质量两层：结构化 deterministic（必做）+ 可选语义 eval（落盘）。
- 基线：typecheck / build / test:coverage（108 文件 / 527 测试 / 全局 branch 80.09%）/ 业务文件≤400 行。
