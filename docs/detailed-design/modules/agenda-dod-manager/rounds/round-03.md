# Agenda & DoD Manager Spec Round 03

## 当前草稿判断

第三版已经接近最终边界。剩余重点是让它支撑“简单但不虚假”的 grow 体验。

用户输入可以很轻，但 feng 必须认真处理缺口、假设和证据。Agenda 是这个认真处理的文件化层。

## 顶层视角检测

产品心智是：

```text
用户提出目标。
feng 发现缺口、整理材料、定义 DoD、尝试候选、验证。
缺关键内容时等待或请求最少输入。
证据足够时才进入 hatch。
```

Agenda 不应该把复杂度暴露成项目管理工具，但内部必须有可解释的缺口和下一步意图。

## 问题

最终 spec 必须避免：

```text
无限 grow：同一缺口反复失败但继续下一轮。
假装完成：没有证据却把 DoD 标为完成。
提示词化 DoD：DoD 只是 prompt 中一句“请做好”。
过度规划：用户被迫维护复杂任务树。
```

## 调整

最终 spec 采用：

```text
AgendaRecord 是 grow 目标拆解和当前推进状态的 projection。
GapRecord 记录缺口、阻塞原因、需要的最小输入和重试边界。
DoDItem 记录完成条件、证据要求和验证意图。
AttemptIntent 记录下一轮 attempt 的目的、约束和期望证据。
AgendaEvent 记录每次定义、调整、阻塞、retire 和 supersede。
```

Evidence & Readiness 负责最终评价，Agenda 只链接 evaluation ref。

## 进入下一轮的结论

本模块可以进入最终 spec。

最终 spec 必须保留这些硬约束：

```text
Todo 不是证据。
DoD 不是 readiness verdict。
AttemptIntent 不是 attempt。
Gap resolved 不是 hatch ready。
Agenda 不调用 LLM。
Agenda 不编译 message list。
Agenda 不改 grow lifecycle，只提供 summary 和建议。
```
