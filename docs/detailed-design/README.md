# feng 详细设计文档索引

详细设计阶段采用“最终文档 + 轮次目录”的方式维护，避免把草稿、review、检测和最终结论塞进一个过大的文档。多轮材料必须拆到 `docs` 下的目录和独立文件中维护，不把多个轮次合并成单个长文档。

## 文档组织原则

```text
最终结论文档：放在模块目录或 detailed-design 根目录，供后续设计和实现引用。
轮次过程文档：放在同名目录下，按 round-01、round-02 等拆分。
索引文档：每个轮次目录用 index.md 汇总输入、轮次链接和最终结论入口。
```

后续模块 spec 也遵守这个结构：

```text
docs/detailed-design/modules/<module-name>/spec.md
docs/detailed-design/modules/<module-name>/rounds/index.md
docs/detailed-design/modules/<module-name>/rounds/round-01.md
docs/detailed-design/modules/<module-name>/rounds/round-02.md
docs/detailed-design/modules/<module-name>/rounds/round-03.md
```

模块 spec 本体只写完成后的终态事实。检测、调整、反思和被拒绝的草稿放在 rounds 目录中。

## 当前文档

```text
top-level-module-design.md
  顶层模块最终设计。

top-level-module-design-rounds/
  顶层模块设计 5 轮草稿和外部视角 review。

module-spec-process.md
  分模块 SDD spec 的写作规则、三轮检测要求和模块推进顺序。

final-audit.md
  详细设计完成审计，记录模块完整性、关键约束覆盖和刻意未做事项。

modules/
  各模块最终 spec 与检测/调整轮次。
```

## 已开始的模块

```text
modules/domain-model-contracts/spec.md
  全系统共享领域语言和跨模块 contract。

modules/file-native-store/spec.md
  安全、原子、可审计的 file-native 文件底座。

modules/event-ledger-projection/spec.md
  append-only 事件事实源和可重建状态投影机制。

modules/artifact-registry/spec.md
  artifact 引用、metadata、preview、privacy 和 lifecycle 管理层。

modules/policy-capability-boundary/spec.md
  动作边界、权限决策、真实安全边界声明、隐私/发布/上报 policy。

modules/skill-registry/spec.md
  skill catalog、版本、来源、作用域、启用、回滚和默认 feedback router skill。

modules/grow-unit-manager/spec.md
  grow 单元 identity、lifecycle、目标边界摘要、关键引用和协调状态。

modules/admission-feedback-inbox/spec.md
  用户输入、材料、调试上报、反馈单元和上游提议的准入与状态管理。

modules/agenda-dod-manager/spec.md
  grow 目标拆解、缺口、DoD、验证意图和下一轮 attempt 建议。

modules/context-message-compiler/spec.md
  从 file-native 事实编译下一轮 message list artifact、source map、预算和排除说明。

modules/llm-gateway/spec.md
  LLM provider 能力摘要、请求/响应适配、streaming/tool-call 归一化和错误分类。

modules/tool-runtime/spec.md
  工具注册、工具面摘要、输入校验、policy enforce、执行、tool result artifact 和 settlement。

modules/grow-attempt-runner/spec.md
  一次 grow attempt 的可恢复执行编排、turn loop、tool settlement、checkpoint、candidate output 和 attempt trace。

modules/evidence-readiness/spec.md
  证据登记、DoD evaluation、readiness assessment、readiness verdict 和 ready_to_hatch gate。

modules/runtime-contract-registry/spec.md
  hatch 产物运行契约的登记、版本、完整性验证、锁定和解释。

modules/hatch-builder/spec.md
  从 grow 单元提取稳定能力、选择资源、生成排除清单并构建 hatch_package artifact。

modules/target-world-adapter/spec.md
  目标世界输入、输出、动作、验证、失败和调试信号的边界适配层。

modules/agent-runtime-kernel/spec.md
  hatch agent 的 runtime message list、LLM/action loop、trace、debug 和生产版本锁定。

modules/debug-feedback-bridge/spec.md
  hatch runtime、目标世界调试信号和上游 grow 之间的反馈候选桥接、归因、脱敏和上游提议边界。

modules/cli/spec.md
  本地用户入口、命令意图解析、workspace 定位、port 编排、approval 入口和状态解释边界。
```
