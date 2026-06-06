import type { SkillActivationId } from "./types.js";
import type { SkillId } from "../domain/index.js";

export const skillIndexPath = ".feng/skills/index.json";
export const skillActivationIndexPath = ".feng/skills/activations/index.json";

export function skillRecordPath(skillId: SkillId): string {
  return `.feng/skills/records/${skillId}.json`;
}

export function skillActivationPath(activationId: SkillActivationId): string {
  return `.feng/skills/activations/${activationId}.json`;
}
