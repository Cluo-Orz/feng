# 第 18 轮改进文档

## 1. Active Tool Pack

问题：

```text
“bootstrap tools 常驻”容易理解成每轮都暴露所有初始工具。
```

改进：

```text
初始工具可用，但每轮仍由 hook/skill 或 seed loop 选择最小必要工具。
```

## 2. Eval 分层

问题：

```text
删除预置 skill 后，项目 eval 可能尚不存在。
如果 check 默认要求项目 eval，空白 self 无法进入成长。
```

改进：

```text
baseline eval 总是运行。
candidate 声明的项目 eval 存在才运行。
项目 eval 由 grow 生成并沉淀。
```

## 3. 空 index

问题：

```text
cache prefix 写了 skill/world index。
但白板 self 可能没有 skill/world。
```

改进：

```text
skills/world 为空时 index 为空。
不能为了填 index 伪造能力。
```

## 4. MVP baseline eval 列表

补齐：

```text
load-self
schema
permission-boundary
no-secret
llm-provider-boundary
```
