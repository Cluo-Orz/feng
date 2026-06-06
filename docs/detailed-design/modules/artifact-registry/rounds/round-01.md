# Artifact Registry Spec Round 01

## 当前草稿判断

初稿容易把 Artifact Registry 写成一个文件清单：

```text
registerFile。
getFile。
listArtifacts。
deleteArtifact。
```

这不够。feng 的 artifact 不只是附件，它是 file-native 事实和模型可见上下文之间的关键边界。

## 顶层视角检测

从产品概念看，file-native 不等于把所有文件都塞进上下文。下一轮 message list 是编译产物，大工具结果、trace、候选产物、验证报告和 hatch 包都需要可定位，但只有摘要、引用或片段进入活跃上下文。

从调研学习看：

```text
CodeWhale 学到 artifact/receipt 分层。
opencode 学到事件事实、投影历史和 provider request 分层。
learn-claude-code 学到 tool result spill、transcript 保留和活跃摘要。
AssistantAgent 学到 experience/reference/asset/artifact 的披露边界。
```

## 问题

```text
1. 如果 Artifact Registry 只是文件清单，无法表达 preview、privacy、retention、provenance。
2. 如果它直接决定上下文可见内容，会替代 Context & Message Compiler。
3. 如果它直接记录业务状态，会替代 Event Ledger。
4. 如果它管理 hatch 包选择，会替代 Hatch Builder。
```

## 调整

Artifact Registry 应定位为：

```text
管理 artifact identity、metadata、content location、preview、privacy、lifecycle 和 ref resolution。
为大内容提供摘要、预览和受控读取。
为 Event Ledger 提供可引用 ArtifactRef。
为 Context Compiler 提供可选择的 preview/summary/materialization 能力。
为 Hatch Builder 提供可打包资源的引用和排除依据。
```

## 进入下一轮的结论

Round 02 需要定义 artifact 类型、生命周期、metadata、preview、privacy、read/materialize ports，并明确和前三个 foundation 模块的依赖关系。
