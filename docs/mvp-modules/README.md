# MVP Modules

这些文档是当前 MVP 的实现 source of truth。

```text
instance-and-bootstrap.md
kernel-and-loop.md
message-context.md
llm-provider.md
tools-permissions.md
state-artifacts-git.md
check-hatch-cli.md
```

核心模型：

```text
feng binary      runtime
.feng/           当前目录 agent 实例
workspace files  用户任务现场
package/self     hatch 后产品稳定能力
.产品名/         产品在用户目录的运行态
```

历史 review 轮次不是 source of truth。需要保留的设计结论必须沉淀到这些模块文档或上层 `architecture.md` / `core-requirements.md`。
