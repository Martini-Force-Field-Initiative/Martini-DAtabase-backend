import { FileFromHttp } from "../../../types";
import { Readable } from "stream";
import logger from "../../../logger";
import {
  UserModelItps,
  ClientPipelineInputsGRO,
  ClientPipelineInputsPDB,
  GenerateITPInputs,
  VermouthHolder,
} from "./dto";
import ForceFieldStore from "../../../Stores/ForceFieldStore";
import { basename } from "path";
import { stringToStream } from "../../../helpers/inputs";
import { inspect } from "util";

const elasticInclude = /#include "molecule_[0-9]_rubber_band.itp"/;
export const sanitizeGenParamItpInputs = (itp: FileFromHttp): Readable => {
  logger.debug(
    `[SOCKET:PolymerGenerator:sanitizeGenParamItpInputs] sanitizing ${itp.name}`,
  );
  const output = new Readable();
  itp.content.split("\n").forEach((line) => {
    const _ = line.replace(elasticInclude, `;${line}`);
    output.push(_ + "\n");
  });
  output.push(null);
  return output;
};

export const isElasticUserStartModel = (
  model: UserModelItps | undefined,
): boolean => {
  if (model === undefined) return false;
  return model.elasticITP !== undefined;
};

export const isGoUserStartModel = (
  model: UserModelItps | undefined,
): boolean => {
  logger.debug(
    `[polyplyUtils:isGoUserStartModel] model value is ${inspect(model)}`,
  );
  if (model === undefined) return false;
  return model.goITP !== undefined;
};

export const defineEnvItpInputs = (data: VermouthHolder) => {
  /*
     - Extract the general forcefield environment itp files
     - Returns the symbol of the general forcefield
        The resulting values takes into account the elastic|go|classic user start model
         --> WIP
    */
  if (data.vermouthLibs === undefined) {
    throw new Error(
      `[PolymerGenerator::defineItpInputs] No vermouthLibs property in : ${inspect(data)}`,
    );
  }
  const ffStore = ForceFieldStore.getStore();

  const itpEnvSymbols: string[] = data.vermouthLibs.filter((x) =>
    ffStore.availableForceFields.includes(x),
  );
  if (itpEnvSymbols.length == 0) {
    throw new Error(
      `PolymerGenerator::defineItpInputs Error: No forcefield environment detected: ${data.vermouthLibs}`,
    );
  }

  let envForcefieldSymbol = itpEnvSymbols.reduce((acc, curr) => {
    logger.debug(
      `[socket:PolymerGenerator::defineItpInputs] Comparing ${curr} with ${acc}`,
    );
    if (ffStore.isSuperSetOf(curr, acc)) return curr;
    if (ffStore.isSuperSetOf(acc, curr)) return acc;
    throw new Error(
      `PolymerGenerator::defineItpInputs Error: Multiple conflicting forcefield environments detected: ${envForcefieldSymbol}`,
    );
  }, itpEnvSymbols[0]);
  logger.debug(
    `[socket:PolymerGenerator::defineItpInputs] Using ${envForcefieldSymbol} as forcefield from environment ${data.vermouthLibs}`,
  );

  const inputs: { [k: string]: string | Readable } = {};
  // Get the environment forcefield inputs
  for (const absPath of ffStore.getCompleteFilesForForceField(
    envForcefieldSymbol,
  ))
    inputs[basename(absPath)] = absPath;

  return { inputs, envForcefieldSymbol };
};

export const generateTopology = (
  data: ClientPipelineInputsGRO,
  ItpEnvSymbol: string,
): string => {
  if (isGoUserStartModel(data.userStartITP))
    return generateGoTopology(data, ItpEnvSymbol);
  if (isElasticUserStartModel(data.userStartITP))
    return generateElasticTopology(data, ItpEnvSymbol);

  return generateClassicTopology(data, ItpEnvSymbol);
};

const generateGoTopology = (
  data: ClientPipelineInputsGRO | ClientPipelineInputsGRO,
  ItpEnvSymbol: string,
): string => {
  /* Go ITP files must come right after the initial itp include */
  logger.debug(
    "[SOCKET:PolymerGenerator:generateGoTopology] Generating Go topology",
  );
  const ffStore = ForceFieldStore.getStore();

  let topfileStr = "";
  ffStore.getFilesForForceField(ItpEnvSymbol).forEach((f, i) => {
    topfileStr += `#include "${f}"\n`;
    if (i == 0)
      topfileStr += '#include "go_atomtypes.itp"\n#include "go_nbparams.itp"\n';
  });
  return `${topfileStr}#include "polymer.itp"\n[ system ]\npolymol_system\n[ molecules ]\npolymol ${data.number}\n`;
};

const generateElasticTopology = (
  data: ClientPipelineInputsGRO,
  ItpEnvSymbol: string,
): string => {
  logger.debug(
    "[SOCKET:PolymerGenerator:generateElasticTopology] Generating Elastic topology",
  );
  // Tryin to include elastic restraints

  /*const ffStore           = ForceFieldStore.getStore();
        return ffStore.getFilesForForceField(ItpEnvSymbol).map(f=>
            `#include "${f}"`).join("\n") + "\n" +
            `#include "polymer.itp"\n` +
            data.userStartITP?.elasticITP?.reduce((acc, curr) => acc += `#include "${curr.name}"\n`, '') +
            `[ system ]\n${data.name}_system\n` +
            `[ molecules ]\n${data.name} ${data.number}`;
        */
  // WiP
  return generateClassicTopology(data, ItpEnvSymbol);
};

const generateClassicTopology = (
  data: ClientPipelineInputsGRO,
  ItpEnvSymbol: string,
): string => {
  logger.debug(
    "[SOCKET:PolymerGenerator:generateClassicTopology] Generating Classic topology",
  );
  const ffStore = ForceFieldStore.getStore();
  return (
    ffStore
      .getFilesForForceField(ItpEnvSymbol)
      .map((f) => `#include "${f}"`)
      .join("\n") +
    "\n" +
    //includeUserStartITP +
    `#include "polymer.itp"\n` +
    `[ system ]\n${data.name}_system\n` +
    `[ molecules ]\n${data.name} ${data.number}\n`
  );
};

export const appendElasticIncludeToPolymerItpIfNeeded = <
  ItpInfo = string | FileFromHttp,
>(
  polymer: ItpInfo,
  data: ClientPipelineInputsPDB,
): ItpInfo => {
  logger.debug(
    "[SOCKET:PolymerGenerator:appendElasticToPolymerItpIfNeeded] Checking if elastic is needed",
  );

  logger.debug(data.userStartITP);
  logger.debug(isElasticUserStartModel(data.userStartITP));

  if (!isElasticUserStartModel(data.userStartITP)) return polymer;

  logger.debug(
    "[SOCKET:PolymerGenerator:appendElasticToPolymerItpIfNeeded] Appending elastic to polymer.itp",
  );
  let newFileContent =
    typeof polymer === "string"
      ? polymer
      : (polymer as FileFromHttp).content + "\n";
  data.userStartITP?.elasticITP?.forEach((f, i) => {
    newFileContent += `#include "${f.name}"\n`;
    logger.debug(`including this\n${f.name}`);
    if (i > 1)
      throw new Error(
        `[SOCKET:PolymerGenerator:appendElasticToPolymerItpIfNeeded] More than one elastic ITP file is not supported`,
      );
  });

  if (typeof polymer === "string") return newFileContent as ItpInfo;

  return { ...polymer, content: newFileContent } as ItpInfo;
};

export const defineMaybeElasticItpInputs = (
  data: ClientPipelineInputsPDB | ClientPipelineInputsGRO,
): { [key: string]: Readable } => {
  let inputs: { [key: string]: Readable } = {};
  if (isElasticUserStartModel(data.userStartITP))
    data.userStartITP?.elasticITP?.forEach((f) => {
      inputs[f.name] = stringToStream(f.content);
    });
  return inputs;
};

export const defineMaybeGoItpInputs = (
  data: ClientPipelineInputsPDB | ClientPipelineInputsGRO,
): { [key: string]: Readable } => {
  let inputs: { [key: string]: Readable } = {};
  if (isGoUserStartModel(data.userStartITP))
    data.userStartITP?.goITP?.forEach((f) => {
      inputs[f.name] = stringToStream(f.content);
    });
  return inputs;
};
