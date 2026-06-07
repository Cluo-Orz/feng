import type { CLIInvocationId } from "./brand.js";

const root = ".feng/cli";

const enc = (value: string): string => encodeURIComponent(value).replaceAll("%", "~");

export const cliInvocationIndexPath = `${root}/invocations/index.json`;

export const cliInvocationPath = (id: CLIInvocationId): string => `${root}/invocations/${enc(id)}.json`;
