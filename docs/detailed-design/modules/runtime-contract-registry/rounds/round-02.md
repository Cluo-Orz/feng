# Runtime Contract Registry Spec Round 02

## 当前草稿判断

第二版草稿补齐了运行边界，但有变成 agent 模板中心的风险。

风险表现为：

```text
默认 contract 都有 dialogue input。
默认 contract 都有 LLM prompt。
默认 contract 都用同一种 action loop。
默认 contract 都要求 Agent Runtime Kernel。
```

这会违背 feng 的核心判断：hatch 形态由目标世界长出来，而不是先验套模板。

## 顶层视角检测

目标世界不同，contract 形态不同：

```text
游戏 boss 可能接收 tick state，输出 action event。
小说 agent 可能接收材料、章节目标和作者反馈，输出章节、修订或评审。
小车 agent 可能接收传感器状态，输出控制指令。
音乐 agent 可能接收结构、风格和素材，输出片段、工程文件或评审事件。
非 LLM runtime 可能是行为树、状态机、脚本模块或服务。
```

Registry 应记录这些形态，而不是把它们统一成聊天机器人。

## 问题

```text
如果 Registry 规定统一 agent loop，会把 feng 变成 agent creator。
如果 Registry 规定统一对话接口，会破坏目标世界决定 runtime 形态。
如果 Registry 绑定 Agent Runtime Kernel，会让 non-LLM hatch 产物失去合法性。
```

## 调整

固定 kernel type：

```text
standard_agent_kernel
custom_agent_kernel
non_llm_runtime
hybrid_runtime
```

并明确：

```text
Runtime Contract Registry 记录 kernel type，不实现 kernel。
Agent Runtime Kernel 只消费 agent 形态的 contract。
Target World Adapter 负责目标世界输入、动作和验证边界的具体适配。
contract 可以包含 dialogue input，但不默认包含。
```

## 进入下一轮的结论

Runtime Contract Registry 是多形态 contract registry，不是 agent 模板中心。下一轮要检查它与 Hatch Builder、runtime implementation、feedback routing 的边界。

