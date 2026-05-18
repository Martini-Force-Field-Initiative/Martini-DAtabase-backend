import {
  SocketController,
  ListenTo,
  SocketControllerRegister,
} from "socket-controller-rdy";
import logger from "../../../logger";
import { PolyplyJob, PolyplyJobSettings } from "../../../Entities/entities/job";
import { dateFormatter, generateSnowflake } from "../../../helpers/simple";
import HistoryOrganizer from "../../../HistoryOrganizer";
import { stringToStream } from "../../../helpers/inputs";
import { inspect } from "util";
import { FileFromHttp } from "../../../types";
import ForceFieldStore from "../../../Stores/ForceFieldStore";
import { defineEnvItpInputs } from "../polymerGenerator/polyplyUtils";
interface PolymerHistorySavePacket {
  gro: FileFromHttp;
  pdb: FileFromHttp;
  top: FileFromHttp;
  itps: FileFromHttp[];
  name: string;
  userId: string;
  vermouthLibs: string[];
}

@SocketControllerRegister
export class History extends SocketController {
  @ListenTo()
  async add(data: PolymerHistorySavePacket) {
    logger.debug(
      `[socket:polymer_generator::add_to_history] incoming PolymerSavePacket:\n ${inspect(data)}`,
    );
    const ffStore = ForceFieldStore.getStore();
    try {
      /* const settings = { "ff" : "martini3001" }
             if (forcefield === "martini3")
                 settings.ff = "martini3001";
             else if (forcefield === "martini2")
                 settings.ff = "martini22";
             else
                 logger.warn(`[route:polymer_generator::add_to_history] Unregistred forcefield \"${forcefield}\"`);
             */
      const { envForcefieldSymbol } = defineEnvItpInputs(data);
      if (!ffStore.isAvailableForceField(envForcefieldSymbol)) {
        logger.error(
          `[route:polymer_generator::add_to_history] Unregistred forcefield \"${envForcefieldSymbol}\"`,
        );
        throw new Error(
          `[History::add_to_history] Unregistred forcefield \"${envForcefieldSymbol}\"`,
        );
      }
      const { gro, pdb, top, itps, name } = data;
      const jobid = await HistoryOrganizer.save({
        jobId: generateSnowflake(),
        userId: data.userId,
        type: "polyply",
        name,
        files: {
          coarse_grained: [stringToStream(pdb.content), pdb.name],
          gro: [stringToStream(gro.content), gro.name],
          top_file: [stringToStream(top.content), top.name],
          itp_files: [
            itps.map((itp) => [stringToStream(itp.content), itp.name]),
            //[ stringToStream(itp), "polymer.itp" ]
          ],
        },
        settings: { ff: envForcefieldSymbol } as PolyplyJobSettings,
      });
      logger.info(
        `[route:polymer_generator::add_to_history] Job ${jobid} successfully saved.`,
      );
      return jobid;
    } catch (e) {
      logger.error(
        `[route:polymer_generator::add_to_history] Failed to save ${data}: \"${e}\" `,
      );
      return false;
    }
  }
}
