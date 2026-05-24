# MVP Review 第 1 轮推演报告

## 1. 本轮目标

检查 MVP 设计是否满足最核心要求：

```text
允许 feng 自己迭代自己
但不为 feng 提供定制化逻辑
```

## 2. G01 通用性检查

### 2.1 观察

MVP 文档明确禁止：

```text
if project == feng
fengsmith
自举专用 runtime
自举专用 prompt 通道
绕过 permissions
```

这是正确的。

### 2.2 风险

文档引入了：

```text
feng init-self
```

这个命令如果解释不清，可能被误解为 feng 自举专用命令。

但当前文档给出的解释是：

```text
在当前仓库初始化 self repo、.feng 和 Git 语义。对已有 feng 仓库也走同一逻辑。
```

这可以是通用命令，适用于任何已有项目目录，不是 feng 专用逻辑。

### 2.3 判断

G01 满足，但建议在 MVP 文档中再明确：

```text
init-self 是“把当前目录变成 feng workspace”的通用命令。
不是自举专用命令。
```

## 3. G02 自迭代闭环检查

MVP 闭环：

```text
init-self
grow
check
hatch --name feng --portable
新 feng 继续 init-self/grow/check/hatch
```

闭环成立。

## 4. G03-G10 快速检查

| 编号 | 判断 | 说明 |
| --- | --- | --- |
| G03 文件即自我 | 满足 | self repo 文件清单明确。 |
| G04 LLM 和工具 | 满足 | LLM adapter、message compiler、tools、permissions 都出现。 |
| G05 Token efficiency | 满足 | stable prefix、dynamic suffix、artifact refs、active tool pack 都有。 |
| G06 Git 成长 | 满足 | candidate、validated commit、tag、repair 已定义。 |
| G07 Check | 满足 | check 阻止坏 candidate promote。 |
| G08 Hatch | 满足 | hatch 产物和排除项清楚。 |
| G09 可观测性 | 满足 | status/watch/artifacts 和 GUI 只读。 |
| G10 简单性 | 满足 | 仍是四核心对象。 |

## 5. 本轮结论

MVP 初版方向正确。

需要小修：

```text
明确 init-self 是通用命令，不是 feng 自举专用逻辑。
```
