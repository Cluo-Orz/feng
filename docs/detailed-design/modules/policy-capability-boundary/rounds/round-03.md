# Policy & Capability Boundary Spec Round 03

## 当前草稿判断

第三版已经接近最终模块边界：

```text
它是能力请求的决策层。
它不是执行层。
它不声称提供强沙箱。
它能写下真实边界、approval、grant、redaction 和 audit。
```

主要剩余风险是写 spec 时把“policy 配置 schema”写得过细，提前进入实现阶段。

## 顶层视角检测

从产品终态看，用户不应该先理解一套复杂权限后台才能使用 feng。feng 的简单感来自：

```text
用户提出智能行为。
grow 在文件事实、证据、目标世界和边界中推进。
缺关键权限或材料时最小化请求确认。
hatch package 声明运行契约、权限、资源和反馈边界。
```

Policy 模块应该服务这个简单体验，而不是成为一个用户必须手工维护的权限中心。

## 问题

需要避免三种误区：

```text
把 policy 写成“安全即配置”，忽略真实执行边界。
把 approval 写成一次性万能授权，忽略作用域和撤销。
把隐私过滤写成可选 UI 功能，忽略多层反馈和 hatch 发布中的数据所有权。
```

尤其在小说场景中：

```text
libai 项目的作品原文默认属于作品项目。
xiaoshuo 可以接收作品层反馈，但不默认把原文上报给 feng。
feng 只吸收系统性 grow/hatch/feedback/skill 问题。
```

这要求 policy decision 能处理上游提议、脱敏、拒绝和本地保留。

## 调整

最终 spec 采用以下边界：

```text
Policy 管理 capability、action request、decision、grant、approval、revocation 和 boundary declaration。
Policy 读取 artifact/privacy/source/contract summary 等元数据。
Policy 写入 policy stream 的 decision/grant/revoke/approval 事件。
Policy 不执行 action，不保存 artifact content，不改变 grow/feedback/hatch 状态。
Policy 通过 constraints 和 requiredEvidence 指导调用方执行。
```

最终 spec 不定义完整策略文件 schema，不定义 provider adapter，不定义 OS sandbox 实现。

## 进入下一轮的结论

本模块可以进入最终 spec。

最终 spec 必须保留这些硬约束：

```text
所有高风险动作必须有 PolicyDecision。
PolicyDecision 不是动作执行结果。
allow 不代表绕过 File Store、Tool Runtime、Hatch Builder 或 Target World Adapter 的结构检查。
ask 必须绑定 approval receipt 或 scoped grant。
privacy metadata 必须参与 artifact export、feedback upstream 和 hatch publish。
unsupported 必须显式失败，不能伪装成 allow。
```
