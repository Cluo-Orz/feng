# 第 10 轮改进文档

## 1. 总体判断

本轮发现的是表达清晰度问题，不是架构方向问题。

需要修改：

```text
release 术语残留
repair 失败现场如何进入下一轮上下文
```

不需要修改：

```text
核心对象
loop
message list
token efficiency
Git 成长模型
hatch 打包模型
自举模型
```

## 2. 改进一：release 术语收敛

### 问题

公开路径已经是：

```text
grow -> check -> hatch
```

但架构文档有少量位置仍把 `release` 写成类似主动作。

### 修改

已把这些地方改成：

```text
hatch 后
hatch package
hatch 预览
hatch 是命名可执行产物
```

保留 `release package` 作为技术产物名。

## 3. 改进二：repair 和 token efficiency 连接

### 问题

candidate 失败后，文档说 agent 修复 candidate，但没有明确失败证据如何被下一轮看到。

### 修改

已补充：

```text
失败报告、diff 和验证结果写入 .feng/artifacts/
下一轮通过 artifact refs 进入上下文
```

这同时满足：

```text
R13 Reload / Repair
R04 Token Efficiency
R16 可观测性
```

## 4. 不做的修改

不把 R01-R20 验收矩阵复制进 `docs/architecture.md`。

原因：

```text
architecture.md 是概念文档
core-requirements.md 是需求文档
review-method.md 是推演方法
round-XXX 是审计证据
```

边界清楚比把所有信息堆在一个文件里更简单。

## 5. 本轮结论

已修改 `docs/architecture.md`。

修改是小范围术语和连接补强，没有扩大架构。
