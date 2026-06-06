# Skill Registry Spec Round 02

## 当前草稿判断

第二版已经把 skill 拆成 descriptor、body、activation 和 lifecycle，但仍有边界混乱：

```text
body 由谁保存。
激活由谁允许。
本轮可见由谁决定。
skill 变更是否等于能力成熟。
```

## 顶层视角检测

已完成模块给出的边界是：

```text
Artifact Registry 管理 skill_body artifact 的内容、metadata、privacy 和 lifecycle。
Policy & Capability Boundary 判断 skill.activate 是否允许、是否需要确认、是否受约束。
Event Ledger & Projection 记录 skill lifecycle 事件并提供可重建 projection。
File-Native Store 提供底层读写和路径安全。
Domain Model & Contracts 提供 SkillId、SkillRef、SkillDescriptor 等共享语言。
```

Skill Registry 不能拥有这些模块的底层职责。

## 问题

第二版还需要收紧三点：

```text
skill body 不应被 Registry 当成普通字符串内联管理，大内容必须通过 ArtifactRef。
activation 不等于 message list visibility；启用的 skill 本轮仍可能不可见。
版本回滚不等于删除历史；必须追加事件，保留来源和证据。
```

此外，skill 的来源需要区分，否则多层回流会污染：

```text
system_default
workspace_local
grow_generated
hatch_imported
user_imported
upstream_proposed
external_package
```

## 调整

第三版增加以下事实：

```text
SkillRecord 保存 descriptor、version、source、scope、bodyRef、assetRefs、declaredCapabilities、lifecycle 和 audit。
SkillVersion 是不可变版本点，更新产生新 version，不改写旧 version。
SkillActivation 表示某个 version 在某个 scope 下启用、禁用、pin 或 rollback。
Skill Registry 在激活前取得 PolicyDecision。
Skill body 通过 Artifact Registry materialize。
Context Compiler 根据 grow 状态、DoD、policy、tool surface 和 skill descriptor 决定本轮可见性。
```

## 进入下一轮的结论

下一轮需要专门验证默认 feedback router skill：

```text
基础协议是否稳定。
场景策略是否可 grow。
变更是否有版本、来源、证据和回滚。
是否不会绕过 Admission & Feedback Inbox 直接修改反馈状态。
```
