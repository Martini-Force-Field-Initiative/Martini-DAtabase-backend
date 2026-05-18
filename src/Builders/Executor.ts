import {
  CONECT_PDB_PATH,
  CREATE_GO_PATH,
  CREATE_MAP_PATH,
  INSANE_PATH,
  MARTINIZE_PATH,
  RUN_POLYPLY_PATH,
  PDB2GRO_PATH,
  JOB_MANAGER_SETTINGS,
  MINIMIZEPDB,
  SLURM_PROFILES,
  INIT_POLYPLY_PATH,
  CREATE_MAP_RCSU_PATH,
  RUN_REBOX_PATH,
  SET_VERSIONS_PATH,
  INSANE_DEF_BUILDER_PATH,
} from "../constants";
import { ArrayValues, generateSnowflake } from "../helpers/simple";
import { isReadableStream } from "../helpers/inputs";
const SupportedScripts = [
  "rebox",
  "pdb2gro",
  "insane",
  "conect",
  "convert",
  "go_virt",
  "ccmap",
  "martinize",
  "polyply",
  "get_polyply_settings",
  "map_rcsu",
  "set_polyply_version",
  "set_martinize_version",
  "insane_def_builder",
] as const;
export type SupportedScript = ArrayValues<typeof SupportedScripts>;
import jmClient from "ms-jobmanager";
import logger from "../logger";
import { JobOptAPI } from "ms-jobmanager";
import { Errors as JobErrors } from "ms-jobmanager";
import { inspect } from "node:util";
/*
type RunMode = 'server' | 'local';
const DEFAULT_RUN_MODE = 'server'
*/

const SCRIPTS: { [scriptName in SupportedScript]: string } = {
  pdb2gro: PDB2GRO_PATH,
  conect: CONECT_PDB_PATH,
  convert: MINIMIZEPDB,
  go_virt: CREATE_GO_PATH,
  ccmap: CREATE_MAP_PATH,
  insane: INSANE_PATH,
  martinize: MARTINIZE_PATH,
  polyply: RUN_POLYPLY_PATH,
  get_polyply_settings: INIT_POLYPLY_PATH,
  map_rcsu: CREATE_MAP_RCSU_PATH,
  rebox: RUN_REBOX_PATH,
  set_polyply_version: SET_VERSIONS_PATH,
  set_martinize_version: SET_VERSIONS_PATH,
  insane_def_builder: INSANE_DEF_BUILDER_PATH,
};

const SERVER_MODULES: { [scriptName in SupportedScript]: string[] } = {
  pdb2gro: ["gromacs"],
  conect: ["gromacs"],
  convert: ["gromacs"],
  go_virt: ["martinize2"],
  ccmap: ["mad-utils"], // GLA_2024 TO MODIFY
  insane: ["insane"],
  martinize: ["martinize2", "gromacs"],
  rebox: ["mad_services"],
  polyply: ["polyply"],
  get_polyply_settings: ["polyply"],
  map_rcsu: ["rcsu"],
  set_polyply_version: ["polyply"],
  set_martinize_version: ["martinize2"],
  insane_def_builder: ["gromacs", "mad_services"],
};

export default new (class Executor {
  public id = "";
  async run(what_to_launch: SupportedScript, args: JobOptAPI) {
    logger.debug(
      `[EXECUTOR:run]Starting job \"${what_to_launch}\" modules:${inspect(SERVER_MODULES)}`,
    ); // in mode ${this.mode}`);
    if (this.id === "") this.id = generateSnowflake();
    args.script = SCRIPTS[what_to_launch];
    args.modules = SERVER_MODULES[what_to_launch];
    args.jobProfile = SLURM_PROFILES.JOB_PROFILE;
    args.sysSettingsKey = SLURM_PROFILES.SYS_SETTINGS;

    logger.debug(`[EXECUTOR:run]Launch args inputs:\n ${inspect(args)}`);
    // This is a lazy-loaded singleton, multiple start call is safe
    try {
      await jmClient.start(
        JOB_MANAGER_SETTINGS.address,
        JOB_MANAGER_SETTINGS.port,
      );
    } catch (e) {
      throw new ExecutorStartConnectionError(
        `Cant' connect @${JOB_MANAGER_SETTINGS.address}:${JOB_MANAGER_SETTINGS.port}`,
      );
    }
    return await jmClient.pushFS(args);
  }
})();

export class ExecutorStartConnectionError extends Error {}

export const isJobStderrNotEmptyFS = (
  e: any,
): e is JobErrors.JobStderrNotEmptyFS => {
  return e?.constructor.name === "JobStderrNotEmptyFS";
};

const viewJobOpt = (data: JobOptAPI): string /*[string, string][]*/ => {
  const viewer: [string, string][] = [];
  const inputs = data.inputs;
  if (!inputs) return "[]";
  if (Array.isArray(inputs)) {
    inputs.forEach((e) => {
      if (typeof e === "string") viewer.push([e, "<path>"]);
      else
        for (let k in e)
          viewer.push([
            k as string,
            isReadableStream(e[k]) ? "<stream>" : "<path>",
          ]);
    });
  }
  return viewer.reduce((acc, c) => {
    return acc + c.join(" : ") + "\n";
  }, "");
};
