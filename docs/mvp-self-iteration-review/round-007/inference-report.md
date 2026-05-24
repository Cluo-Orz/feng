# MVP Review 第 7 轮推演报告

## 1. 本轮目的

本轮针对 MVP 文档的核心问题：

```text
MVP 预置四个 skill，导致 feng 自举不是从白板开始。
```

## 2. 自迭代重新推演

### 2.1 bootstrap

`feng grow "改进 feng 自己"` 在当前目录运行。

如果 self 不存在，kernel 只创建：

```text
identity.md
goal.md
hooks.yaml
permissions.yaml
interface.yaml
config.schema.yaml
skills/README.md
world/README.md
evals/load-self.yaml
evals/llm-provider-boundary.yaml
.feng/
Git 成长状态
```

这里没有读取需求、架构 review、编辑 self、修复 candidate 的预置 skill。

### 2.2 seed loop

因为 hooks 没有匹配 skill，kernel 进入通用 seed loop：

```text
latest event
self index
文件索引
初始四工具
artifact refs
```

LLM 通过读文件、列目录、运行允许命令理解当前仓库，然后生成 candidate world/skills/evals。

### 2.3 candidate skill 形成

如果目标确实是改进架构文档，LLM 可以生成：

```text
skills/read-requirements.md
skills/architecture-review.md
skills/edit-self.md
skills/repair-candidate.md
evals/case-first-review.yaml
world/feng-project.md
```

但这些是 candidate，不是初始模板。

### 2.4 check

check 验证：

```text
self 能加载
schema 能解析
权限边界有效
provider 不含真实 key
candidate skill/eval 能运行
没有专用自举命令
没有 project == 当前项目名 的 runtime 分支
```

### 2.5 hatch

check 通过后，kernel 更新 validated commit。hatch 从 validated commit 打包下一版 feng。

## 3. 发现和修改

```text
1. 删除 MVP 预置四个 skill。
2. 删除预置 feng project world。
3. 删除预置 case-first review eval。
4. hooks.yaml 初始为空。
5. 增加通用 seed loop。
6. 删除 MVP 主文档中 fengsmith / if project == feng 的具体历史词，改成通用禁止项。
```

## 4. 可实施性判断

修改后 MVP 更难，但更正确。

它要求 kernel 具备真正的通用初始能力：

```text
读目录
读文件
写文件
运行受限命令
组装 token-efficient message
保存 artifacts
check candidate
Git 记录成长
```

这正是 feng MVP 应该验证的内容。
