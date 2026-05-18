import { stringToStream } from "../../../helpers/inputs";
import logger from "../../../logger";
import ItpFile from "itp_mad_parser";
import checkError from "./errorParser";
import Executor from "../../../Builders/Executor";
import {
  SocketController,
  ListenTo,
  SocketControllerRegister,
  Socket,
} from "socket-controller-rdy";
import { inspect } from "util";
import HistoryOrganizer from "../../../HistoryOrganizer";
import { generateSnowflake } from "../../../helpers/simple";
import { PolyplyJobSettings } from "../../../Entities/entities/job";
import Mailer from "../../../Mailer/Mailer";
import { Database } from "../../../Entities/CouchHelper";
import { URLS } from "../../../constants";
import { Readable } from "stream";
import { basename } from "path";
import { JobOptInputs } from "ms-jobmanager/shared/types/common/jobopt_model";
import ForceFieldStore from "../../../Stores/ForceFieldStore";
import SettingsWrapper from "../../../helpers/settingsManager";
import PolyplyStore from "../../../Stores/PolyplyStore";
import { FileFromHttp } from "../../../types";
import {
  GenerateITPInputs,
  ClientPipelineInputsGRO,
  ClientPipelineInputsPDB,
  ClientPipeLineResult,
} from "./dto";
import {
  generateTopology,
  sanitizeGenParamItpInputs,
  defineEnvItpInputs,
  defineMaybeElasticItpInputs,
  defineMaybeGoItpInputs,
  appendElasticIncludeToPolymerItpIfNeeded,
} from "./polyplyUtils";

// TO DO types  userStart CORECTLY

/* TO DO taken from martinize equivalent
async function sendMailPolyplyEnd(userId: string, jobId: string) {
    const user = await Database.user.get(userId);
    logger.debug(`Send an email to ${user.email} for job completion`)
    Mailer.send({
      to: user.email,
      subject: "MArtini Database - Job completed"
    },
      "mail_job_completed", {
      name: user.name,
      job_id: jobId,
      job_url: URLS.SERVER + '/builder/' + jobId
    }).catch(logger.error)
  }
*/

const createVirtBoundPolymerMix = (
  listGraphComponent: string[][],
  itp: FileFromHttp,
): string => {
  //Need to add fake links

  const polymerItpContent = itp.content;
  let previous_res = listGraphComponent[0][0];
  let itpparsed = ItpFile.readFromString(polymerItpContent);
  const atoms = itpparsed.getField("atoms", true);

  const splititp = polymerItpContent.split("[ bonds ]");
  let itpSTART = splititp[0] + "[ bonds ]\n";

  for (let i of listGraphComponent.slice(1)) {
    let next_res = i[0];
    logger.info(
      `[polymeGenerator:createVirtBoundPolymerMix] need to link  ${previous_res} with ${next_res}`,
    );
    let previousbead = "";
    let nextbead = "";
    for (let i of atoms) {
      if (
        i.split(" ").filter((e) => {
          return e !== "";
        })[2] == previous_res
      ) {
        previousbead = i.split(" ").filter((e) => {
          return e !== "";
        })[0];
      }
      if (
        i.split(" ").filter((e) => {
          return e !== "";
        })[2] == next_res
      ) {
        //console.log( "nextbead", i.split(' ').filter((e) => { return e !== "" })[0] )
        nextbead = i.split(" ").filter((e) => {
          return e !== "";
        })[0];
      }
    }
    //console.log(i)
    //1  3 1 0.350 4000
    //create a new link
    let new_link = previousbead + " " + nextbead + " 6 1 1000 ;FAKE LINK\n";
    logger.debug(`[createVirtBoundPolymerMix] new_link ${new_link}`);
    itpSTART = itpSTART + new_link;

    previous_res = next_res;
  }
  const copy_itp = itpSTART + splititp[1];
  logger.info(
    `[socket:polymeGenerator:createVirtBoundPolymerMix] rebuildt itp:\n${copy_itp}`,
  );
  return copy_itp;
};

// MOST ERRORS SHOULD NOT REQUIRE socket trailer  argument but be explicetly thrown and unwrap on client-side.
@SocketControllerRegister
export class PolymerGenerator extends SocketController {
  debug = false;
  @ListenTo()
  async version() {
    const sw = await SettingsWrapper.getSettingsWrapper();
    return sw.serviceVersions.polyply;
    /*const polyplyStore = PolyplyStore.getStore();
    return polyplyStore.version;*/
  }

  @ListenTo()
  async polyply_data() {
    const polyplyStore = PolyplyStore.getStore();
    const ffStore = ForceFieldStore.getStore();
    const _ = {
      libData: polyplyStore.polyplyData,
      envs: polyplyStore.environments,
      documentation: ffStore.metadata,
    };
    logger.debug(
      `[socket:PolymerGenerator:polyply_data] Sending:\n${inspect(_, { depth: 4 })}`,
    );
    return _;
  }

  @ListenTo()
  async generateITP(
    dataFromClient: GenerateITPInputs,
    socket: Socket,
  ): Promise<FileFromHttp> {
    /*
            Returns ITP file of the desired polymer
            the polymer is passed as a graph encoded in JSON.
            Additional connection rules or custom molecules can pe passed
            under the 'customITP' field.
        */

    logger.info(
      `socket:PolymerGenerator:generateITP] inputs:${inspect(dataFromClient, { depth: 4 })}`,
    );

    //Get polyply -lib
    const ff = dataFromClient["polymer"]["targetPolyplyLib"];
    // Get eventual polyply -ff
    const ffStore = ForceFieldStore.getStore();
    const aVlibs = ffStore.availableVermouthLibs;

    const optLibs = dataFromClient.vermouthLibs.filter((o) =>
      aVlibs.includes(o),
    );
    logger.debug(`active f libs: ${optLibs}`);

    const itpEnvDef = defineEnvItpInputs(dataFromClient);
    const inputs: JobOptInputs = {
      ...itpEnvDef.inputs,
      "polymer.json": stringToStream(JSON.stringify(dataFromClient.polymer)),
      "custom_links.itp": stringToStream(dataFromClient.customITP.customLinks),
      "custom_molecules.itp": stringToStream(
        dataFromClient.customITP.customMolecules ??
          ";placeholder for uploaded multiple molecules itp def",
      ),
    };

    dataFromClient.customITP.userStart?.moleculeITP.forEach(
      (file: FileFromHttp) => {
        //inputs[file.name] = stringToStream(file.content);
        inputs[file.name] = sanitizeGenParamItpInputs(file);
      },
    );
    let genparam_f_flag = `-f ${
      dataFromClient.customITP.userStart?.moleculeITP
        .map((f) => `input/${f.name}`)
        .join(" ") ?? ""
    } input/custom_links.itp input/custom_molecules.itp `;

    // The -ff flag doesnot exist in polyply, all is passed unde -f flag
    //let genparam_ff_flag = optLibs.length == 0 ? "" : "-ff ";
    optLibs.forEach((lib) => {
      const abs_files = ffStore.getVermouthLibraryFilePaths(lib);
      abs_files.forEach((f, i) => {
        const b = basename(f);
        inputs[b] = f;
        //genparam_ff_flag += `input/${b} `;
        genparam_f_flag += `input/${b} `;
      });
    });

    // Try to happen elasticDefs in -f ITP
    /*dataFromClient.customITP.userStart?.elasticITP?.forEach(elasticITP=> {
            logger.warn(`[socket:PolymerGenerator::GenerateITP] Adding elastic ITP file: ${elasticITP.name}`);
            genparam_f_flag += `input/${elasticITP.name} `;
            inputs[elasticITP.name] = stringToStream(elasticITP.content);
        })*/

    const genparam_ITPOUT = "polymer.itp";
    const exportVar = {
      ff: ff,
      name: dataFromClient.name,
      action: "itp",
      genparam_f_flag,
      //genparam_ff_flag,
      ITPOUT: genparam_ITPOUT,
    };
    let result: string | undefined;

    try {
      logger.debug(
        '[socket:PolymerGenerator::GenerateITP] Running "gen_param" Step...',
      );
      const { stdout, jobFS } = await Executor.run("polyply", {
        exportVar,
        inputs,
      });
      result = stdout;
      const maybeErrLinks = await jobFS.list("missing_links.warn");
      if (maybeErrLinks.length > 0) {
        logger.warn(
          '[socket:PolymerGenerator::GenerateITP] "gen_param" step displayed missing link definition',
        );
        const missLink = await jobFS.readToString("missing_links.warn");
        throw new Error(missLink);
      }
    } catch (e: any) {
      logger.error(
        `[socket:PolymerGenerator::GenerateITP] \"gen_param\" Error!: ${e}`,
      );

      const errorData = checkError(`${e}`);
      // Try to scavenge itp file out of missing Link expection
      errorData.itp = result;
      logger.debug(
        `[socket:PolymerGenerator::GenerateITP] errorData thrown\n${inspect(errorData)}`,
      );
      throw new Error(JSON.stringify(errorData));
    }
    logger.debug(
      `[socket:PolymerGenerator::GenerateITP] completed returning following itp content:\n${result}\n`,
    );
    return {
      name: genparam_ITPOUT,
      content: result,
      type: "itp",
    };
  }

  @ListenTo()
  async generateGRO(data: ClientPipelineInputsGRO, socket: Socket) {
    logger.info(
      `[socket:PolymerGenerator::generateGRO] input ${inspect(data)}`,
    );

    //Get forcefield
    const { userStartGRO, name, box, listGraphComponent } = data;
    let { inputs, envForcefieldSymbol } = defineEnvItpInputs(data);

    if (userStartGRO !== undefined) {
      logger.info(
        `[socket:PolymerGenerator::generateGRO] Found a user GRO, wrapping it`,
      );
      const inputs = { "coord.gro": stringToStream(userStartGRO.content) };
      try {
        const { stdout, jobFS } = await Executor.run("rebox", { inputs });
        userStartGRO.content = await jobFS.readToString("wrapped.gro");
        userStartGRO.name = "coord_boxed.gro";
      } catch (e) {
        logger.error(
          `[socket:PolymerGenerator::generateGRO] Error wrapping user GRO:\n${e}`,
        );
        throw new Error(
          "PolymerGenerator::generateGRO Error wrapping user GRO:" + `${e}`,
        ); // not captured on client side yet
      }
    }

    const exportVar = {
      box,
      name,
      action: "gro",
      USR_GRO: "",
    };

    const topfileStr = generateTopology(data, envForcefieldSymbol);

    // This has not been checked
    const polymerItpContent =
      data.listGraphComponent.length > 1
        ? createVirtBoundPolymerMix(listGraphComponent, data.itp)
        : data.itp.content;

    const elInputs = defineMaybeElasticItpInputs(data);
    const goInputs = defineMaybeGoItpInputs(data);
    inputs = {
      ...inputs,
      ...elInputs,
      ...goInputs,
      "polymer.itp": stringToStream(polymerItpContent),
      "system.top": stringToStream(topfileStr),
    };
    if (userStartGRO !== undefined) {
      inputs[userStartGRO.name] = stringToStream(userStartGRO.content);
      exportVar["USR_GRO"] = userStartGRO.name;
    }

    try {
      const { stdout } = await Executor.run("polyply", { exportVar, inputs });
      logger.info(
        `[socket:PolymerGenerator::generateGRO] success, emittting following  .gro and .top`,
      );
      logger.debug(
        `generateGRO:'.gro':\n${inspect(stdout)}\ngenerateGRO:'.top':${inspect(topfileStr)}`,
      );
      return { gro: stdout, top: topfileStr };
    } catch (e: any) {
      logger.error(
        `[socket:PolymerGenerator::generateGRO] Runtime Error (e type is): ${typeof e}`,
      );
      logger.error(
        `[socket:PolymerGenerator::generateGRO] Runtime Error: ${inspect(e)}`,
      );
      // Try to process - save polyply errors
      const errorData = checkError(`${e}`);
      logger.error(
        `[socket:PolymerGenerator::generateGRO] Runtime Error trying to throw this object`,
      );
      logger.error(inspect(errorData));
      throw new Error(JSON.stringify(errorData));
    }
  }

  @ListenTo()
  async generatePDB(
    data: ClientPipelineInputsPDB,
    socket: Socket,
  ): Promise<ClientPipeLineResult> {
    /*
        Converting GRO into PDB for 3D vizu, running a quick minimization
        */
    logger.info(
      `[socket:PolymerGenerator::generatePDB] starting GRO to PDB: conversion and quick minimize `,
    );
    logger.debug(
      `[socket:PolymerGenerator::generatePDB] input:${inspect(data)}`,
    );

    const { readyTop, readyGro, doSendEmail } = data;

    // We have to append elastic include if any
    const itp = appendElasticIncludeToPolymerItpIfNeeded(data.itp, data);
    itp.name = "polymer.itp"; //  rename it from polymer.itp|custom_fix.itp on client-side
    //const itp = data.itp
    const ffStore = ForceFieldStore.getStore();
    const exportVar = {
      basedir: "",
      MDP_FILE: ffStore.getProductionFile("run.mdp"),
    };

    let { inputs, envForcefieldSymbol } = defineEnvItpInputs(data);
    const goInputs = defineMaybeGoItpInputs(data);
    let elInputs = defineMaybeElasticItpInputs(data);
    inputs = {
      ...inputs,
      ...elInputs,
      ...goInputs,
      "polymer.itp": stringToStream(itp.content),
      "em.mdp": ffStore.getProductionFile("em.mdp"),
      "file.gro": stringToStream(readyGro),
      "file.top": stringToStream(readyTop),
    };

    //for ( const absPath of ffStore.getCompleteFilesForForceField(minimizerFfBundle) )
    //    inputs[basename(absPath)] = absPath;

    //inputs[martiniItpFileBasename] =`${FORCE_FIELD_DIR}/${martiniItpFileBasename}`;

    try {
      const { stdout, jobFS } = await Executor.run("convert", {
        exportVar,
        inputs,
      });
      const fileContent = await jobFS.readToString("output-conect.pdb");
      logger.info(`[socket:PolymerGenerator::generatePDB] Success, Saving...`);

      logger.debug(
        `[socket:PolymerGenerator::generatePDB] Saving job... w/ settings.ff ${data.targetPolyplyLib}`,
      );

      const jobid = await HistoryOrganizer.save({
        jobId: generateSnowflake(),
        userId: data.userId,
        type: "polyply",
        name: data.name,
        files: {
          coarse_grained: [stringToStream(fileContent), "polymer.pdb"],
          gro: [stringToStream(readyGro), "polymer.gro"],
          top_file: [stringToStream(readyTop), "polymer.top"],
          itp_files: [
            [
              [stringToStream(itp.content), "polymer.itp"],
              ...(data.userStartITP?.goITP?.map(
                (f) =>
                  [stringToStream(f.content), f.name] as [Readable, string],
              ) ?? []),
              ...(data.userStartITP?.elasticITP?.map((f) => {
                return [stringToStream(f.content), f.name] as [
                  Readable,
                  string,
                ];
              }) ?? []),
            ],
          ],
        },
        settings: { ff: envForcefieldSymbol } as PolyplyJobSettings,
      });

      if (doSendEmail) {
        sendMailPolyplyEnd(data.userId, jobid as string);
        logger.debug(
          `[route:polymer_generator::generatePDB] Email-auto saved succesfull for job ${jobid}`,
        );
      }
      const _ = data.userStartITP?.goITP ?? [];
      // streams being one-time-usable, we regenerate the object with FileFromHttp for client live answer
      const ans = {
        files: {
          pdb: { content: fileContent, name: "polymer.pdb", type: "pdb" },
          gro: { content: readyGro, name: "polymer.gro", type: "gro" },
          top: { content: readyTop, name: "polymer.top", type: "top" },
          itps: [
            //{ content: itp.content, name:"polymer.itp", type:"itp" }, // renami
            itp,
            ...(data.userStartITP?.goITP ?? []),
            ...(data.userStartITP?.elasticITP ?? []),
          ],
        },
        jobid,
      };
      logger.debug(
        `[socket:PolymerGenerator::generatePDB] Successfull, returning:\n${inspect(ans)}`,
      );
      return ans;
    } catch (e: any) {
      logger.error(
        `[socket:PolymerGenerator::generatePDB] GMX, conversion/minimization Error:\n${e.toString()}`,
      );
      throw new Error(
        `[socket:PolymerGenerator::generatePDB] GMX, conversion/minimization Error:\n${e.toString()}`,
      );
    }
  }
}

async function sendMailPolyplyEnd(userId: string, jobId: string) {
  logger.debug(
    `[socket:PolymerGenerator:sendMailPolyplyEnd] userId:'${userId}' jobId:'${jobId}'`,
  );
  const user = await Database.user.get(userId);
  logger.debug(`Send an email to ${user.email} for job completion`);
  Mailer.send(
    {
      to: user.email,
      subject: "MArtini Database - Job completed",
    },
    "mail_job_completed",
    {
      name: user.name,
      job_id: jobId,
      job_url: URLS.SERVER + "/builder/" + jobId,
    },
  ).catch(logger.error);
}
