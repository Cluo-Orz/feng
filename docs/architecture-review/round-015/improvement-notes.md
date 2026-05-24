# 第 15 轮改进文档

## 1. Grow 和 Execute 需要明确分界

问题：

```text
架构文档提到 mode: execute | grow，但没有解释产品含义。
MVP 文档中 feng hatch 后继续 grow/check/hatch，容易被误读为普通 agent 也要暴露 feng 命令。
```

改进：

```text
grow mode：创造者使用，允许修改 self repo，并用 Git 表达 candidate / validated。
execute mode：使用者使用，运行 hatch 出来的命名命令，默认不修改 packaged frozen self。
```

普通 agent 的 execute interface 来自 `interface.yaml`。feng 自举产物仍叫 `feng`，所以它的 execute interface 也是 grow/check/hatch。

## 2. Skill 不能只是 prompt block

问题：

```text
文档说 skill 是成长单位，但没有给出最小结构。
如果 skill 只是 prompt 文本，后续会重新退化为 prompt block 系统。
```

改进：

```text
skill 最小字段：
when
goal
context
tools
output
checks
```

skill 可以包含 prompt 文本，但 message compiler 决定本轮放什么进 messages。

## 3. Hook 脚本的边界

问题：

```text
用户提到 hook 未来可能有脚本。
如果不写边界，hook script 可能绕过 tool/permission/check。
```

改进：

```text
hook 可以触发脚本。
脚本必须作为 tool 受 permissions 和 check 管理。
hook 仍是事件点，不是第二套执行系统。
```

## 4. 不新增系统

本轮没有引入：

```text
mode manager
skill runtime
hook script runtime
prompt compiler DSL
```

新增的只是概念边界，仍由 Runtime Kernel + Self Repo + .feng State + Git 承载。
