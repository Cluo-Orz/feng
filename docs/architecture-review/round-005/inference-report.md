# 第 5 轮推演报告

## 1. 输入变化

本轮新增三类输入：

```text
1. teach / try / release 作为公开命令显得机械，需要更符合 feng 的产品语言。
2. 架构文档缺少 LLM message list 的明确编排方式。
3. 新增 feng 自举 case：让 feng 用同一套机制孵化下一版 feng 自己。
```

本轮按当前 `docs/architecture.md` 客观推演，不提前把新增设计当成已存在事实。

## 2. 命名推演

当前架构公开链路是：

```text
feng new xiaogui
feng teach "..."
feng try
feng release --name xiaogui --portable
```

这条链路功能清楚，但产品气质偏传统 agent 框架。

对照核心诉求，feng 更像一个孵化系统：

```text
workspace 是身体
self repo 是自我
Git 是成长历史
hatch 是破壳成品
```

因此 `teach / try / release` 可以解释功能，但没有体现“成长、检查、破壳”的主线。当前架构没有给出命名层和内部语义层的区分。

## 3. Message List 推演

当前架构写了：

```text
assemble context
kernel 组装上下文
core / selected / working / history
```

但没有说明 LLM 最终收到的 messages list 如何排列。

这会影响：

```text
OpenAI / Anthropic adapter 映射
缓存 key 稳定性
context 压缩策略
hook 和 skill 的插入位置
tool result 如何进入下一轮
assistant 历史是否保留
```

当前架构能说明“材料从哪里来”，但还没有说明“材料如何排成 message list”。

## 4. Feng 自举推演

目标不是孵化一个新的命令，而是让 feng 自己完成同名孵化：

```text
feng grow "让 feng 更好地校准自己的架构、代码和验证方式"
feng check
feng hatch --name feng --portable
```

这个 case 的特殊性不是命令特殊，而是 world 特殊：feng 面对的是 feng 自己的仓库。

self repo 应包含：

```text
world/       feng 项目结构、核心诉求、架构评审规则、源码和测试结构
skills/      架构推演、不过拟合检查、文档改写、Git checkpoint、hatch 验证
tools/       read/write/list/run_command，必要时沉淀 Git helper 或 build helper
evals/       示例架构评审任务、加载检查、基础 CLI 检查
permissions 允许读写项目、读取 Git、创建 commit/tag、生成 portable package
```

当前架构可以解释大部分路径，因为 feng 项目本身也是一个 workspace。

但自举暴露一个关键边界：

```text
它会修改用于定义 feng 的文档和未来代码。
```

因此架构必须明确：

```text
自举不应获得特殊 runtime
自举仍然通过 workspace、Git、permissions、evals 工作
自举失败时保留 candidate 和失败现场，不强制吞掉现场
```

当前架构没有明确把“同名自举 hatch”作为验证架构的基准。

## 5. 跨案例影响

新增问题不是只影响自举 case。

命名问题影响所有创造者：

```text
teach / try / release 让产品像框架
grow / check / hatch 更贴近孵化模型
```

message list 问题影响所有 agent：

```text
coding 需要稳定加入 diff / test result
api testing 需要加入 spec / tool result / mock result
news 需要加入摘要和引用
carbrain 需要加入当前传感器和安全边界
deskhelper 需要加入权限和操作计划
feng 自举需要加入架构轮次和 Git diff
```

自举问题影响架构自洽性：

```text
如果 feng 不能用自己的机制 hatch 下一版 feng，文件即自我和 workspace 孵化就不完整。
```

## 6. 本轮客观结论

当前架构主线仍成立，但存在三个结构性缺口：

```text
公开命令语言不够贴合 feng 的孵化隐喻
LLM message list 编排未定义
同名自举 hatch 未进入架构验证标准
```

这三个问题都应在架构文档中以顶层方式补充，不能扩展成复杂实现规格。
