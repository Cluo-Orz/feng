import { makeNonEmptyBrand, type BrandedString } from "../domain/brand.js";

export type CLIInvocationId = BrandedString<"CLIInvocationId">;

export const makeCLIInvocationId = (value: string): CLIInvocationId =>
  makeNonEmptyBrand("CLIInvocationId", value);
