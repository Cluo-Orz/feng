# 第 16 轮改进文档

## 1. 是否需要修改主文档

不需要。

本轮没有发现新的结构性缺口。

## 2. 为什么不继续扩写

继续扩写会把实现规格塞回概念文档，反而破坏当前清晰度。

当前概念已经足够支撑：

```text
普通目录第一次 grow
已有项目 grow
长任务 state
token-efficient message list
Git candidate repair
hatch 成命名命令
feng 自举
```

## 3. 后续应移动到实现规格

还需要写，但不应写进架构概念文档的内容：

```text
YAML schema
ArtifactRef JSON schema
Permission rule matcher
Provider adapter 参数细节
Hatch package 文件格式
CLI 参数解析细节
GUI 页面布局
```

这些属于实现期。
