# Artifact Registry Spec Round 03

## 当前草稿判断

第三轮准备定稿。当前设计把 Artifact Registry 限定为 artifact 记录、引用解析、预览、隐私元数据和生命周期管理。

## 顶层视角检测

从顶层模块设计检查：

```text
Artifact Registry 是 Foundation 模块。
它被 Context Compiler、Tool Runtime、Grow Attempt Runner、Evidence、Hatch Builder、Agent Runtime Kernel 使用。
它不编译 message list。
它不决定 readiness。
它不选择 hatch 包内容。
```

从产品概念检查：

```text
file-native 要求关键产物可定位。
message list 是编译产物，不能被 artifact preview 替代。
hatch 不能复制 grow 目录，artifact registry 只能提供候选资源和排除信息。
反馈上报不能泄漏隐私，artifact privacy 必须可被 policy/feedback 使用。
```

## 问题

仍需防止：

```text
1. Artifact Registry 直接将 artifact 注入模型上下文。
2. Artifact Registry 直接发布 hatch 包。
3. Artifact Registry 删除内容导致历史事件不可解释。
4. Artifact Registry 把外部文件直接当可信 artifact。
```

## 调整

最终 spec 应明确：

```text
artifact registration 不等于采纳。
artifact preview 不等于 message list。
artifact lifecycle 不等于业务 lifecycle。
artifact materialization 必须返回来源、版本、隐私和截断状态。
删除/脱敏后，引用仍能返回 redacted/unavailable 状态，支持审计。
```

## 进入最终 spec 的结论

Artifact Registry 可以定稿。它是大内容和 file-native 证据的引用层，是后续 Context Compiler、Tool Runtime、Evidence、Hatch、Runtime Trace 的基础，但不替代这些模块的业务决策。
