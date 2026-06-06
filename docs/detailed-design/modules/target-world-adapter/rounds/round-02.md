# Target World Adapter Spec Round 02

## 当前草稿判断

第二版草稿覆盖了多种目标世界，但有膨胀风险：

```text
内置游戏引擎。
内置小说创作平台。
内置模拟器。
内置音乐工作站。
自己决定目标世界规则。
```

这会让 feng 变成平台集合，而不是 file-native grow/hatch 系统。

## 顶层视角检测

Target World Adapter 应该做稳定的边界工作：

```text
描述目标世界。
校验 Runtime Contract 是否与目标世界兼容。
归一化目标世界输入。
归一化 runtime 输出为目标世界动作或事件。
映射目标世界失败。
暴露验证入口和调试信号。
```

具体游戏引擎、小说项目、音乐工具、模拟器仍是外部或包内 adapter 实现。

## 问题

```text
如果 Adapter 拥有目标世界业务规则，会与具体项目冲突。
如果 Adapter 执行 runtime 决策，会与 Agent Runtime Kernel 冲突。
如果 Adapter 构建 package，会与 Hatch Builder 冲突。
如果 Adapter 判断 readiness，会与 Evidence & Readiness 冲突。
```

## 调整

固定：

```text
Target World Adapter 不运行 agent。
Target World Adapter 不构建 hatch package。
Target World Adapter 不判断 readiness。
Target World Adapter 只通过 adapter port 与宿主目标世界交互。
目标世界规则通过 descriptor、contract 和外部 adapter 表达。
```

## 进入下一轮的结论

Target World Adapter 是归一化与边界层。下一轮要检查 debug、validation 和 feedback 是否会绕过准入污染 grow。

