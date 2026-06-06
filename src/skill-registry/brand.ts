import { makeNonEmptyBrand } from "../domain/brand.js";
import type { SkillActivationId } from "./types.js";

export const makeSkillActivationId = (value: string): SkillActivationId =>
  makeNonEmptyBrand("SkillActivationId", value);
