# Hatch Builder Spec Round 02

## 当前草稿判断

第二版草稿开始提取资源，但仍可能退化成 prompt wrapper：

```text
打包系统提示词。
打包几个材料文件。
打包一个命令入口。
```

这不满足 feng 对 hatch 产物的质量要求。尤其当 hatch 结果是 agent 时，它不能只是 prompt 加命令包装。

## 顶层视角检测

合格 hatch package 至少需要：

```text
RuntimeContractRef。
runtime kernel type。
入口和宿主接入说明。
必要资源和 skill 版本。
能力依赖和权限边界。
debug contract 和 feedback contract。
验证摘要。
版本和回滚信息。
发布排除清单。
```

对于 non-LLM runtime，它可能没有 prompt；对于 agent runtime，它必须有真实 runtime kernel 边界和上下文治理能力。

## 问题

```text
只打包 prompt 会让 agent 不可调试、不可观察、不可回滚。
缺 runtime contract 时，目标世界不知道如何调用。
缺 feedback contract 时，下游失败无法回流。
缺验证摘要时，用户无法判断为什么“成了”。
```

## 调整

固定：

```text
Hatch Builder 必须引用 locked RuntimeContractRef。
Hatch package manifest 必须记录 runtime kernel type。
Hatch package 必须带 debug/feedback 能力入口或明确不适用原因。
Hatch package 必须带 evidence/readiness summary。
Hatch package 不要求所有产物都是 LLM agent。
```

## 进入下一轮的结论

Hatch Builder 的产物是运行包，不是 prompt 包。下一轮要检查发布安全、自动更新和回滚边界。

