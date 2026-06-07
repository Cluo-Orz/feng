# `feng write` — the xiaoshuo command (autonomous serialized novel writing)

## Scope

Delivers a runnable **xiaoshuo command**: `feng write` autonomously writes a serialized Chinese novel chapter-by-chapter, file-native, each chapter continuing the last. This is the concrete realization of "grow/hatch out a xiaoshuo command that writes 《李白重生了》" and of feng's long-running capability.

- `src/host/prompts.ts` — feng's prebuilt xiaoshuo writing prompt (`XIAOSHUO_SYSTEM_PROMPT`), the per-chapter user-prompt builder, and a robust `parseChapterOutput` that splits the model output into chapter body + a one-line outline on a `===OUTLINE===` marker (deriving an outline if the model omits it).
- `src/host/xiaoshuo-writer.ts` — `writeNextChapter` / `writeNovel`:
  - Reads/writes a file-native `.feng/xiaoshuo/novel-state.json` holding the premise, title, and the ordered list of chapter records (number, outline, path, char count, artifact id).
  - Each call derives the next chapter number from state, feeds all prior outlines as the running context, makes a policy-gated LLM call through feng's own gateway, parses the chapter + outline, writes the chapter to `chapters/chapter-NN.md`, registers it as a `candidate_output` artifact, and appends to state.
  - `writeNovel({ chapters: N })` loops to write N chapters in one command (long-running), returning partial results if a later chapter fails.
- `feng write --premise <p> [--title <t>] [--chapters <n>]` wired into `runCli` (with an injectable `fetchImpl` for offline tests).

## Why state-file continuation (design judgment)

`feng grow run` continuation carries an outline through Admission (verified earlier), but the grow loop's prompt format is not controllable for structured output. The xiaoshuo command needs a deterministic "chapter + outline" contract, so it drives the LLM gateway directly with feng's prebuilt prompt and persists a dedicated file-native novel-state. This keeps everything in files (concept-compliant: "运行中产出的内容都必须能在文件里找到") while giving reliable, autonomous serialization. This is a deliberate, concept-aligned adaptation, not a shortcut around feng's modules — the call still goes through the real policy boundary, gateway, and artifact registry.

## Verification (live)

`feng write --premise "诗仙李白醉酒坠采石矶后魂穿现代成都…" --title 李白重生了 --chapters 3` against DeepSeek produced three coherent, continuous chapters (1821 / 1852 / 2103 chars) under `chapters/`, with a correct serialized arc: ch1 苏醒于2024成都遇陈伯 → ch2 火锅店得知酒吧街诗词比赛 → ch3 比赛中以诗才折服众人获奖金、被陈公子盯上. Chapter 3 explicitly references chapter 2's clue (the hotpot waiter's tip about the 诗词比赛 and 五千块钱), confirming real continuity from persisted state.

`npm run typecheck`, `npm run build`, `npm run test:coverage` all pass (96 files / 455 tests, global branch 80.14%). New files are 173 / 64 / 99 lines (≤ 400).

## Boundary Checks

- The writer calls the LLM only after a real `network.request` policy decision through the Policy Boundary; it never bypasses policy.
- All outputs are file-native: chapter markdown files, a JSON novel-state, and registered artifacts.
- The provider key is only ever passed to the adapter's auth header (unchanged from the host layer).

## Self-repair loop (M3e core, within-instance)

`writeNextChapter` now self-checks its own output: if a produced chapter is below `MIN_CHAPTER_CHARS` (500), the writer records the issue and automatically retries once with a correction instruction ("上一稿仅 N 字，过短，请扩写…"), up to `MAX_REPAIRS`. The accepted chapter, a `repaired` flag, and the list of `issues` are returned and persisted. This is feng detecting a deficiency in its own output and repairing/retrying itself — the within-instance core of the nested "采集问题→自己修复→重试" loop, verified by a fake-fetch test (short draft → repaired long draft).

## Residual risks / follow-ups

- Continuity is outline-carried (prior chapter prose is not re-fed verbatim); for very long novels this is the scalable choice but may drift over many chapters — a future pass could fold the previous chapter's tail in via `artifactCandidateRefs`.
- The self-repair currently keys on length; richer checks (continuity, constraint adherence) and routing issues through the Debug & Feedback Bridge for cross-instance supervision remain the larger M3e work.
- `feng write` is a host-level command (needs the gateway/model), deliberately kept out of the module CLI ports to avoid widening `CLIPorts`.
