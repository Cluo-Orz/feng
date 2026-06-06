# Target World Adapter Spec Round 01

## 当前草稿判断

第一版草稿容易把 Target World Adapter 写成：

```text
把目标世界状态转成一段对话文本。
把模型回答转成文本输出。
```

这个草稿不成立。它会把 boss、小车、音乐、小说都压成聊天接口。

## 顶层视角检测

feng 的核心判断是目标世界决定 runtime 形态。不同目标世界需要不同输入和输出：

```text
游戏 boss 接收 tick state，输出 action event。
小车接收 sensor frame，输出 control command。
小说 agent 接收材料、章节目标、作者反馈，输出章节或修订。
音乐 agent 接收结构和素材，输出片段或工程事件。
```

对话可以是其中一种 input mode，但不能成为默认形态。

## 问题

```text
对话接口无法表达实时 tick、传感器、动作、事件和验证入口。
文本输出无法表达 target action 的 policy 和结构边界。
把状态写成 prompt 会绕过 Runtime Contract。
```

## 调整

补入：

```text
TargetWorldDescriptor
TargetWorldAdapterDefinition
WorldInputEnvelope
WorldOutputEnvelope
TargetActionRequest
TargetValidationReport
TargetFailureMapping
TargetDebugSignal
```

## 进入下一轮的结论

Target World Adapter 必须是目标世界边界层，不是对话转换器。下一轮要检查它是否又膨胀成目标世界平台本身。

