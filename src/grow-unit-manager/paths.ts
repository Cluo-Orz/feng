import type { GrowUnitId } from "../domain/index.js";

const root = ".feng/grow-units";

export const growUnitIndexPath = `${root}/index.json`;
export const growUnitRecordPath = (id: GrowUnitId): string => `${root}/records/${id}.json`;
