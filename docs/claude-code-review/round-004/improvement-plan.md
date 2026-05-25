# Claude Code 借鉴 Review 第 4 轮改进方案

本轮没有发现需要修改主文档的结构性问题。

不新增功能，不继续修补。

保留当前设计：

```text
小内核
文件化 self
.feng state/events/artifacts
Git candidate/validated/tag
skill 两级加载
active tool pack
token-efficient message compiler
provider-neutral LLM adapter
通用 seed loop
```

后续如果进入实现，应优先按 `docs/mvp-modules/` 做代码模块，而不是再扩展概念文档。
