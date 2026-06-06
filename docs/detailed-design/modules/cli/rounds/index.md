# CLI Spec Rounds

本文索引 `CLI` 模块 spec 的三轮检测与调整。

## 输入文档

```text
docs/product-concept.md
docs/feng-system-overview-design.md
docs/feng-kernel-and-long-running-design.md
docs/feng-novel-case-flow.md
docs/detailed-design/top-level-module-design.md
docs/detailed-design/module-spec-process.md
docs/detailed-design/modules/*/spec.md
```

CLI 是最后一个模块，因此它必须读取前面模块的 port 边界，而不是重新发明业务流程。

## 轮次

```text
round-01.md
  检测“CLI 命令手册化”和“隐藏 session”风险，确立 command intent、execution context 和 invocation receipt。

round-02.md
  检测 CLI 是否吞掉业务模块，收窄为 port 编排层和 explain 层。

round-03.md
  检测长程任务、policy approval、非 LLM runtime、debug feedback 和机器可读输出边界。
```

## 最终结论

最终 spec 见：

```text
docs/detailed-design/modules/cli/spec.md
```

