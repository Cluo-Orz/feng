# Skill Registry Development Review

## Scope

Implemented `Skill Registry` as feng's skill catalog, version, activation, and materialization layer.

Files:

```text
src/skill-registry/*
tests/skill-registry/*
src/domain/result.ts
src/index.ts
```

Reread before implementation:

```text
docs/detailed-design/modules/skill-registry/spec.md
docs/detailed-design/modules/skill-registry/rounds/round-01.md
docs/detailed-design/modules/skill-registry/rounds/round-02.md
docs/detailed-design/modules/skill-registry/rounds/round-03.md
docs/detailed-design/top-level-module-design.md
docs/development-reviews/policy-capability-boundary.md
docs/development-reviews/artifact-registry.md
docs/development-reviews/event-ledger-projection.md
```

Reference code reviewed:

```text
opencode/packages/core/src/skill.ts
opencode/packages/core/src/skill/discovery.ts
opencode/packages/core/src/skill/guidance.ts
opencode/packages/core/src/tool/skill.ts
opencode/packages/core/src/config/plugin/skill.ts
AssistantAgent/.../experience/model/Experience.java
AssistantAgent/.../experience/disclosure/ExperienceDisclosureService.java
AssistantAgent/.../management/model/SkillPackage.java
AssistantAgent/.../management/internal/SkillPackageParser.java
Shinsekai/sdk/tool_registry.py
Shinsekai/core/plugins/plugin_host.py
Shinsekai/frontend_bridge_core/plugin_catalog.py
```

## Implementation

The module now provides:

```text
Skill source, lifecycle, scope, record, activation, candidate, and materialization types.
File-native catalog index and record persistence.
File-native activation index and activation persistence.
Skill markdown discovery without automatic registration.
Skill body registration through Artifact Registry as skill_body artifacts.
Immutable version creation.
Version comparison summary.
Version retraction.
Policy-gated activation, pin, and rollback.
Disable without deleting records.
Active skill listing as candidates only.
Skill body materialization through Artifact Registry.
Skill summary loading without body content.
Candidate search and candidate explanation.
Default feedback router registration/activation helper.
Skill lifecycle and activation events through Event Ledger.
```

## Design Fit

The implementation keeps Skill Registry out of three traps:

```text
It does not auto-inject skills into prompts.
It does not execute skills or tools.
It does not treat declaredCapabilities as granted permissions.
```

Key invariants are preserved:

```text
discover != register
register != active
active != visible in message list
skill body is an ArtifactRef
activation requires a PolicyDecision with allow/allow_with_constraints
candidate/upstream_proposed skills cannot be activated directly
rollback writes a new activation fact and does not rewrite history
default_feedback_router is a default skill family, but does not mutate feedback state
```

This matches the concept requirement that multi-layer feedback skills can evolve without becoming an automatic upstream absorption path.

## Completeness Check

Implemented without feature stubs:

```text
discoverSkills
registerSkill
getSkill
listSkills
addSkillVersion
compareSkillVersions
retractSkillVersion
activateSkill
disableSkill
pinSkillVersion
rollbackSkill
listActiveSkills
loadSkillBody
loadSkillSummary
findSkillCandidates
explainSkillCandidate
ensureDefaultFeedbackRouter
```

Covered risk cases:

```text
Discovery event is not silent if ledger append fails.
Skill lifecycle events do not inline body content.
External skill activation without policy allow is blocked.
Policy deny maps to policy_blocked.
Expired activation is not active.
Disabled activation removes the skill from active candidates.
Retracted skill cannot be activated.
Rollback target must exist in the same family.
Redacted skill body materialization returns privacy_blocked.
Malformed catalog/activation indexes fail explicitly.
Missing indexed activation records are skipped, but malformed activation records are not hidden.
```

## Reference Judgment

Useful ideas borrowed:

```text
opencode: separate skill source/discovery from model-visible guidance.
AssistantAgent: progressive disclosure via lightweight candidate cards and explicit body/reference reads.
Shinsekai: registry/manifest rows should not imply execution safety or prompt visibility.
```

Ideas intentionally not copied:

```text
Plugin marketplace UX.
Process-global decorator registration as durable truth.
Session-based skill availability.
Tool execution through the skill registry.
Automatic prompt injection.
```

## Verification

Commands run:

```text
npm run typecheck
npm run test:coverage
npm run build
```

Results:

```text
Typecheck: passed
Tests: 65 passed
Coverage: statements 89.12%, branches 80.44%, functions 97.93%, lines 96.51%
Build: passed
Line-count check: no src/tests TypeScript file over 400 lines
```

## Review Notes

The module is viable as a complete first implementation. The main remaining architectural obligation is on later `Context & Message Compiler`: it must treat active skills as candidates and write message-list source explanations when it chooses visibility. If a later module starts reading `SkillRecord.bodyRef` directly into prompts, that would violate this module's boundary.
