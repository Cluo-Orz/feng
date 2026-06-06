# Skill Registry Spec Round 01

## 当前草稿判断

第一版容易写成“技能目录”：

```text
扫描某个目录。
找到 skill 文件。
把 skill 描述和正文加载出来。
在 grow 时注入 prompt。
```

这个草稿的问题是太像 prompt 插件系统，甚至会把 feng 带成 skills hub。

## 顶层视角检测

顶层模块设计对 Skill Registry 的要求是：

```text
管理 skill 的发现、版本、来源、启用状态、作用域和按需加载。
拥有默认 feedback router skill。
不把 skill 自动塞进 prompt。
Context & Message Compiler 决定本轮哪些 skill 可见。
```

调研结论也很一致：

```text
skill 应分层：目录/描述常驻，正文/引用/脚本按需进入当前轮。
默认反馈 skill 可以演进，但必须可撤销、可审计、有作用域。
skill 可以补充运行模式，但强约束必须落在 contract、工具权限和状态机里。
feng 不能照搬 skills hub、插件市场或 provider/plugin 管理器。
```

## 问题

第一版有四个明显误区：

```text
把 skill 自动注入 prompt，破坏 message list 是编译产物的不变量。
把 skill 当安全边界，绕开 Policy 与 Tool Runtime。
把 skill 更新当成学习完成，忽略来源、证据、版本和回滚。
把默认 feedback router skill 当成无条件上游吸收机制。
```

如果不修正，Skill Registry 会变成“被调研对象牵着走”的拼装产品入口。

## 调整

第二版把 Skill Registry 限定为 registry 和 lifecycle 层：

```text
skill descriptor 常驻可索引。
skill body 是 ArtifactRef，按需读取。
skill activation 有作用域、版本、来源、policy decision 和审计事件。
skill 变更需要 evidenceRef 和 rollback target。
Context Compiler 只向它请求候选 skill 和 body materialization，不由它决定 prompt 内容。
```

默认 feedback router skill 被标记为 system default skill，但它只提供反馈路由策略和协议说明，不直接修改 feedback 状态。

## 进入下一轮的结论

下一轮需要检查：

```text
Skill Registry 是否与 Artifact Registry 的内容生命周期重叠。
Skill Registry 是否与 Policy 的 skill.activate 能力边界重叠。
默认 feedback router skill 是否既默认存在，又不会把反馈自动吸收到上游。
```
