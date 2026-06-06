# Artifact Registry Spec Round 02

## 当前草稿判断

第二轮草稿引入：

```text
ArtifactRecord。
ArtifactRef。
ArtifactKind。
ArtifactLifecycle。
ArtifactPreview。
ArtifactPrivacyClass。
ArtifactMaterialization。
```

## 顶层视角检测

从已完成模块检查：

```text
Domain Model & Contracts 提供 ArtifactId、ArtifactRef、SourceDescriptor、VersionDescriptor。
File-Native Store 提供安全读写和 receipt。
Event Ledger 记录 artifact lifecycle 事件，但不拥有 artifact 内容。
```

Artifact Registry 应依赖这三个模块，但不能反向要求它们理解 artifact 语义。

## 问题

```text
1. artifact kind 不能绑定到具体目录或文件扩展名，否则过早进入 schema。
2. preview 不能被当作完整内容，避免上下文误用。
3. privacy 不能只靠标签，后续 Policy 和 Feedback Bridge 必须能检查它。
4. retention/delete 不能破坏 Event Ledger 可回放性；事件可保留失效引用状态。
```

## 调整

终态边界：

```text
Artifact Registry 保存 artifact record 和内容位置。
Artifact record 可演进，带 version/source/audit/privacy。
Artifact content 可以是文本、二进制、目录包或外部 handle。
Preview 是派生视图，用于快速展示和上下文候选，不是真相来源。
Artifact deletion/retraction 通过 lifecycle 表达，旧 Event 引用返回 artifact_unavailable 或 redacted。
Policy 决定是否允许读取/上报/发布，Artifact Registry 执行 privacy metadata 和 materialization guard。
```

## 进入下一轮的结论

Round 03 需要检查它是否会吞掉 Message Compiler 和 Hatch Builder 的职责，并定稿 ports、不变量和验证要求。
