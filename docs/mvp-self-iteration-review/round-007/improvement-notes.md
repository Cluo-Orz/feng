# MVP Review 第 7 轮改进文档

## 1. 删除预置能力

删除：

```text
skills/read-requirements.md
skills/case-first-review.md
skills/edit-self.md
skills/repair-candidate.md
world/feng-project.md
world/architecture.md
world/review-method.md
evals/review-method.yaml
evals/no-special-runtime.yaml 中的具体历史命名
```

## 2. 增加通用 seed loop

无匹配 skill 时：

```text
kernel contract
latest event
self index
文件索引
初始工具
artifact refs
```

这让第一个 grow 能生成第一批 candidate self 文件。

## 3. 保留的最小内容

保留：

```text
identity.md 的白板声明
goal.md 从 latest grow event 派生
world/README.md
skills/README.md
空 hooks.yaml
初始四工具
load/schema/provider/secret 类健康检查
```

## 4. 风险

风险是第一个 grow 的质量更依赖 LLM 和 message compiler。

但这是 feng 的真实 MVP 风险，不能用预置 feng skill 掩盖。
