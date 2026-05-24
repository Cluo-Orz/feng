# MVP 自迭代 Review 方法

## 1. Review 目标

MVP review 只检查一个问题：

```text
当前 MVP 设计是否能在不为 feng 提供定制化逻辑的前提下，用通用逻辑跑通 feng 自迭代。
```

## 2. 必读输入

每轮必须读取：

```text
docs/core-requirements.md
docs/architecture.md
docs/llm-provider-research.md
docs/agent-expectations/feng-agent.md
docs/mvp-self-iteration-design.md
```

## 3. 每轮输出

每轮目录：

```text
docs/mvp-self-iteration-review/round-XXX/
  inference-report.md
  improvement-notes.md
  review.md
```

## 4. Review 维度

每轮至少检查：

```text
G01 通用性
  是否有 feng 专用 runtime、特殊命令、特殊 prompt 通道、if project == feng。

G02 自迭代闭环
  第一次 grow 的 bootstrap、grow、check、hatch、execute 是否能形成闭环。

G03 文件即自我
  self repo 是否表达 identity、goal、skills、hooks、tools、world、evals、interface、permissions。

G04 LLM 和工具
  LLM adapter、message compiler、active tool pack、ToolCall、ToolResult 是否足够。

G05 Token efficiency
  stable prefix、dynamic suffix、artifact refs、active tool pack 是否落地。

G06 Git 成长
  candidate、validated commit、tag、失败现场、repair 是否清楚。

G07 Check
  check 是否能防止坏 candidate promote。

G08 Hatch
  hatch 是否能产出下一版 feng，且不携带 secret、本机 cache、失败 candidate。

G09 可观测性
  running、progress、artifact 是否文件化。

G10 简单性
  是否保持 Runtime Kernel + Self Repo + .feng State + Git，不新增复杂系统。
```

## 5. 修改原则

如果发现问题：

```text
先判断是架构缺口、MVP 文档表达缺口，还是实现期细节。
只修 MVP 文档必要部分。
不要为了一个场景加专用系统。
```

## 6. 退出条件

连续一轮 review 只发现实现期细节，没有 MVP 设计缺口时，可以停止架构级迭代。
