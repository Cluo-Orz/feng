export const hatchRootPath = ".feng/hatch-builder";
export const hatchRequestIndexPath = `${hatchRootPath}/requests/index.json`;
export const hatchBuildPlanIndexPath = `${hatchRootPath}/plans/index.json`;
export const hatchPackageIndexPath = `${hatchRootPath}/packages/index.json`;
export const hatchRequestPath = (id: string) => `${hatchRootPath}/requests/${id}.json`;
export const hatchBuildPlanPath = (id: string) => `${hatchRootPath}/plans/${id}.json`;
export const hatchPackagePath = (id: string) => `${hatchRootPath}/packages/${id}.json`;
export const hatchVerificationPath = (id: string) => `${hatchRootPath}/verifications/${id}.json`;
