# MVP 模块：Kernel and Loop

## 职责

Runtime Kernel 只负责运行通用 loop，不写死领域能力。

```text
read .feng + workspace
-> select skills/tools/prompts
-> compile messages
-> call LLM
-> execute tool calls through permissions
-> write workspace/.feng
-> validate
-> continue or stop
```

## 长程 grow

`grow` 是长程孵化，不是单次问答。

```text
1. acquire .feng/lock
2. append user input to .feng/inbox
3. load goal/state/history
4. select active skill/tool/prompt
5. compile message list
6. call provider
7. execute tool calls
8. write artifacts/events/messages
9. run validation/check when candidate changed
10. if failed, feed failure artifact into next grow turn
11. repeat until done, blocked, missing_config, or budget reached
12. release lock
```

显式 `feng check` 仍然可以存在，但自迭代不能依赖外部 agent 手动执行每一轮 check/repair。

## Hook

MVP hook 只做选择，不执行脚本。

```text
on_grow
on_check_failed
on_execute
```

hook 选择 `.feng/skills` 或 packaged `self/skills` 中的 skill body；skill 可声明本轮需要的 tools。复杂 hook 脚本不是 MVP。

## 输入

```text
.feng/goal.md
.feng/inbox/
.feng/skills/
.feng/tools/
.feng/prompts/
.feng/world/
.feng/state.yaml
.feng/events.jsonl
.feng/artifacts/
workspace file index
workspace Git facts if present
provider profile
```

## 输出

```text
workspace changes
.feng skill/tool/prompt/world/eval changes
.feng/messages/latest.json
.feng/events.jsonl
.feng/artifacts/
.feng/state.yaml
validated instance checkpoint
optional hatch package
```

## 不变量

```text
只有一个 loop。
grow/check/execute 共享 kernel。
mode 只改变 instance root、writable boundary 和 interface。
LLM 不能绕过 permission。
LLM 不能直接推进 validated checkpoint。
```
