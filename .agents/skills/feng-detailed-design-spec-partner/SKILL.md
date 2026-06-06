---
name: feng-detailed-design-spec-partner
description: Use this skill when the user wants to create, critique, extend, or maintain feng's TypeScript detailed-design docs after concept/overview design, especially "顶层模块设计", "模块设计", "详细设计", "SDD spec", "module spec", "检测与调整", "rounds", "final audit", dependency-ordered module specs, or turning feng overview/research docs into docs/detailed-design module specs. Trigger when the task is about disciplined top-level module design and per-module terminal-state specifications, not product concept or implementation coding.
---

# Feng Detailed Design Spec Partner

## Purpose

Help generate and maintain feng's detailed-design documentation after concept and overview design are stable.

Use this skill to preserve the working discipline that produced `docs/detailed-design`: top-level module design first, dependency-ordered module specs second, repeated external-view review, SDD-style terminal facts, directory-based round records, and final audit.

Default to Chinese unless the user asks otherwise.

## Core Stance

Treat the user as product owner, but do not treat user statements, existing docs, or researched agent projects as automatically correct.

Keep these principles active:

- Prevent feng from becoming "被调研对象牵着走"的拼装产品.
- Detailed design is not implementation. Do not write concrete file schemas, full JSON/YAML schemas, provider adapters, complete CLI manuals, eval runners, or TypeScript code unless the user explicitly moves into implementation.
- Module specs describe completed-state facts, not tasks, roadmaps, or "how to implement next".
- The goal is coherent boundaries, ownership, events, artifacts, ports, errors, invariants, and validation surfaces.
- When a design claim feels plausible but hides a boundary problem, challenge it before writing it into a spec.

## Read Existing Context

When working in the feng repo, read only the relevant docs, using `rg` first when the set is large.

For top-level detailed design, prefer:

```text
docs/product-concept.md
docs/agent-research-rounds.md
docs/agent-research-notes.md
docs/agent-design-learning-summary.md
docs/feng-design-prep-rounds.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/feng-novel-case-flow.md
docs/feng-design-completion-audit.md
```

For existing detailed-design maintenance, also read:

```text
docs/detailed-design/README.md
docs/detailed-design/module-spec-process.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/final-audit.md
docs/detailed-design/modules/relevant-module/spec.md
docs/detailed-design/modules/relevant-module/rounds/
```

For later modules, read all direct dependency module specs and any modules that consume the module being changed.

If a named doc is missing, continue with available docs and state the missing context briefly.

## Classify The Request

Before editing, classify the work:

```text
Product concept: use product-concept-partner instead.
Overview design: use feng-overview-design-partner instead.
Detailed design: use this skill.
Implementation: read detailed-design docs first, then implement separately.
```

If the user asks to "沉淀成 spec", "做模块设计", "补详细设计", "维护 detailed-design", or "按 SDD 写终态事实", stay in this skill.

## Document Structure

Use directory-based multi-document maintenance. Do not put all rounds into one giant file.

Top-level module design:

```text
docs/detailed-design/top-level-module-design.md
docs/detailed-design/top-level-module-design-rounds/index.md
docs/detailed-design/top-level-module-design-rounds/round-01.md
docs/detailed-design/top-level-module-design-rounds/round-02.md
docs/detailed-design/top-level-module-design-rounds/round-03.md
docs/detailed-design/top-level-module-design-rounds/round-04.md
docs/detailed-design/top-level-module-design-rounds/round-05.md
```

Per-module design:

```text
docs/detailed-design/modules/module-name/spec.md
docs/detailed-design/modules/module-name/rounds/index.md
docs/detailed-design/modules/module-name/rounds/round-01.md
docs/detailed-design/modules/module-name/rounds/round-02.md
docs/detailed-design/modules/module-name/rounds/round-03.md
```

Add `round-04.md` or later only when the module remains unstable after three rounds.

Maintain:

```text
docs/detailed-design/README.md
docs/detailed-design/progress-audit.md
docs/detailed-design/final-audit.md
```

## Top-Level Module Design Workflow

Use this workflow before writing or rewriting `top-level-module-design.md`.

1. Read concept, overview, kernel/long-running, scenario flow, and relevant research notes.
2. Produce or update a top-level module draft.
3. Review the draft from an external perspective: ignore the current architecture's self-justification and ask whether the product would remain coherent.
4. Re-read relevant research or previous design notes to challenge weak module boundaries.
5. Repeat at least 5 rounds before producing the final top-level module design.

Each round should record:

```text
What was reviewed.
What the current draft gets right.
Where the design is being pulled by researched agents or local assumptions.
Which module boundaries are too broad, too vague, or cyclic.
What changed in the next draft.
```

The final top-level module design should define:

```text
Module list and dependency order.
System-level data/control flow.
Ownership of facts, artifacts, events, policies, feedback, runtime, hatch.
Key cross-module invariants.
What is intentionally not designed yet.
```

Do not define final schema, code layout, provider adapter details, or a complete CLI reference in the top-level design.

## Module Spec Workflow

Design modules in dependency order. Start with foundation modules and move toward orchestration, hatch, runtime, debug, and CLI.

For each module:

1. Read the top-level module design.
2. Read relevant concept/overview/research summaries.
3. Read all prerequisite module specs.
4. Read consuming modules if the spec already exists and this change can affect them.
5. Draft or revise `spec.md` as terminal-state facts.
6. Run at least 3 rounds of `检测 -> 调整`.
7. Keep each round in its own file under `rounds/`.
8. Update README/progress/final audit when the module set changes.

Round format:

```markdown
# Module Name Spec Round NN

## 当前草稿判断
## 顶层视角检测
## 问题
## 调整
## 进入下一轮的结论
```

Detection must step outside the module and ask:

```text
Does this preserve the product promise?
Does this preserve file-native traceability?
Does this preserve "no user-facing session"?
Does this keep message list as artifact, not truth source?
Does this keep feedback as candidate, not automatic upstream absorption?
Does this keep readiness evidence-based?
Does this keep hatch separate from grow noise and local secrets?
Does this let target world determine runtime shape?
Does this avoid copying a researched project's product surface?
Does this conflict with earlier specs or create hidden cycles?
Does this make the user's mental model heavier?
```

## SDD Spec Requirements

Write `spec.md` as completed-state facts.

Cover these sections when relevant:

```text
模块定位。
职责。
不负责。
依赖关系。
核心记录 / TypeScript type families.
Ports / service boundaries.
Events.
Artifact and file-native facts.
Policy and privacy boundary.
Relations to other modules.
Invariants.
Error behavior.
Validation requirements.
Open questions.
```

Use "事实：" blocks to distinguish stable facts from explanation.

Do not write:

```text
TODO
后续需要实现
计划支持
可能考虑
第一步、第二步、第三步实现
```

Open questions are allowed only in an "开放问题" section, and must say they do not invalidate the module's current terminal facts.

## Feng Invariants

Preserve these unless the user explicitly changes product direction:

```text
feng is file-native.
There is no user-facing session concept.
One grow unit is one continuous growth space.
The next grow LLM loop's message list is a file-native artifact.
grow compiled_message_list is owned by Context & Message Compiler.
runtime_message_list is owned by Agent Runtime Kernel.
artifact registration is not business adoption.
User input and runtime feedback must pass Admission & Feedback Inbox.
Readiness depends on evidence and DoD, not model confidence.
ready_to_hatch is not hatch_package.
hatch_package is owned by Hatch Builder.
hatch must not copy the grow directory.
hatch output is not necessarily an LLM agent.
If hatch output is an agent, it needs a runtime kernel, not just a prompt wrapper.
Target world determines runtime shape.
non_llm_runtime must not be forced into Agent Runtime Kernel.
Runtime feedback cannot bypass Debug & Feedback Bridge and Admission.
FeedbackUnit and UpstreamProposal are owned by Admission & Feedback Inbox.
Policy allow is not action execution.
CLI is an entry and orchestration layer, not a business state owner.
```

## Dependency Order Reference

Use this order unless a new top-level design changes it with justification:

```text
1. Domain Model & Contracts
2. File-Native Store
3. Event Ledger & Projection
4. Artifact Registry
5. Policy & Capability Boundary
6. Skill Registry
7. Grow Unit Manager
8. Admission & Feedback Inbox
9. Agenda & DoD Manager
10. Context & Message Compiler
11. LLM Gateway
12. Tool Runtime
13. Grow Attempt Runner
14. Evidence & Readiness
15. Runtime Contract Registry
16. Hatch Builder
17. Target World Adapter
18. Agent Runtime Kernel
19. Debug & Feedback Bridge
20. CLI
```

Later modules must explicitly account for earlier module boundaries. If a later module forces changes to an earlier module, update both specs and record the reason in the round documents.

## Audit Workflow

After creating or changing detailed-design docs, run targeted checks.

Useful checks:

```text
Get-ChildItem docs\detailed-design\modules -Directory
rg -n "TODO|后续需要实现|计划支持|可能考虑" docs\detailed-design\modules
rg -n "session|compiled_message_list|runtime_message_list|ready_to_hatch|hatch_package|FeedbackUnit|UpstreamProposal|non_llm_runtime" docs\detailed-design
git status --short docs\detailed-design
```

For completion audits, verify:

```text
Every module has spec.md.
Every module has rounds/index.md.
Every module has at least 3 round-*.md files.
README lists the new or changed docs.
progress-audit or final-audit reflects the current state.
Forbidden implementation-plan phrases do not appear in module specs.
Core invariants remain visible.
```

## Writing Style

Write in clear Chinese. Prefer direct claims, short paragraphs, and precise boundaries.

Prefer:

```text
该模块拥有 X 的状态语义，但不执行 Y。
received 不等于 admitted。
ready_to_hatch 不等于 hatch_package。
Bridge packet 不等于 FeedbackUnit。
```

Avoid:

```text
空泛愿景。
堆功能名。
把调研对象架构拼成 feng 终态。
把 spec 写成任务清单。
过早规定 schema、目录、adapter、eval runner 或代码。
```

Use `apply_patch` for manual edits. Preserve unrelated user changes.
