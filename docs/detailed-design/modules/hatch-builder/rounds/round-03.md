# Hatch Builder Spec Round 03

## 当前草稿判断

第三版草稿还要处理发布和升级风险：

```text
secret 被打包。
本地私有材料被发布。
自动更新覆盖生产产物。
旧版本无法回滚。
policy deny 被忽略。
```

这些风险会直接破坏 feng 的可信度。

## 顶层视角检测

Hatch 是从成长进入交付的边界。这个边界必须比 grow 更严格：

```text
ready_to_hatch 只是进入 hatch 的条件。
locked runtime contract 只是运行契约条件。
Hatch Builder 还必须检查资源、隐私、发布、版本和可回滚性。
```

开发期可以频繁试包，但生产包必须版本锁定，升级有证据和确认。

## 问题

```text
contains_secret 默认不能进入 package。
project_private 或 contains_user_content 默认不能无确认发布。
retracted artifact 不能被新 package 引用。
package version 不能原地修改。
Hatch Builder 不能自动更新下游 runtime。
```

## 调整

固定以下终态规则：

```text
Hatch Builder 在打包前请求 PolicyDecision。
每个 included resource 必须有 inclusionReason。
每个 excluded resource 必须有 exclusionReason。
hatch_package artifact 只能由 Hatch Builder 创建。
package version 不可原地修改。
自动更新不属于 Hatch Builder。
rollbackTarget 必须进入 manifest。
```

## 进入下一轮的结论

Hatch Builder spec 可以收敛。它负责构建可复制 package，不复制 grow 目录、不发布 secret、不自动更新运行环境。

