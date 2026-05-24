# MVP Review 第 1 轮改进文档

## 1. 问题

`init-self` 可能被误解为 feng 自举专用命令。

MVP 目标要求：

```text
不能为 feng 提供定制化逻辑。
```

## 2. 修改建议

在 `docs/mvp-self-iteration-design.md` 中明确：

```text
init-self 是通用命令。
它把任意已有目录初始化为 feng workspace。
feng 自举只是这个通用命令的一个使用场景。
```

## 3. 不需要修改

不需要删除 `init-self`。

原因：

```text
MVP 自迭代面对的是已有 feng 仓库。
new 更像创建新 workspace。
init-self 更适合“让当前目录成为 workspace”。
```

只要它是通用语义，就不违反架构。
