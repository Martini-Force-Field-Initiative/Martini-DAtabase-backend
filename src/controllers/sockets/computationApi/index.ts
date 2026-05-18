import {
  SocketController,
  ListenTo,
  SocketControllerRegister,
} from "socket-controller-rdy";
import logger from "../../../logger";
import { inspect } from "util";
import Executor from "../../../Builders/Executor";
import { FileFromHttp } from "../../../types";
import ForceFieldStore from "../../../Stores/ForceFieldStore";
interface MadInsaneDefbuilder {
  itp: FileFromHttp;
  forcefield: string;
}
import { basename, extname } from "path";
import { ClientInputAPI } from "ms-jobmanager";
import { InputTextWrapper } from "../../../helpers/inputs";
import { Readable } from "stream";
import { JobOptProxy } from "ms-jobmanager/shared/types/client";

@SocketControllerRegister
export class ComputationApi extends SocketController {
  @ListenTo()
  async generate_insane_defs(data: MadInsaneDefbuilder[]) {
    logger.debug(
      `[socket:ComputationApi::generate_itp_defs] incoming packet:\n ${inspect(data)}`,
    );

    const results = await Promise.all(
      data.map((d) =>
        generate_insane_def(d)
          .then((r) => r)
          .catch((e) => e),
      ),
    );
    return results;
  }
}

const generate_insane_def = async (data: MadInsaneDefbuilder) => {
  const name = data.itp.name;
  const content = data.itp.content;
  const itp_input: { [k: string]: Readable } = {};
  itp_input[name] = InputTextWrapper(data.itp.content, false);
  const ffStore = ForceFieldStore.getStore();

  const inputs = [
    itp_input,
    ...ffStore.getCompleteFilesForForceField(data.forcefield),
  ] as ClientInputAPI;
  console.log(inputs);
  // --no-lt flag switch here
  const exportVar = {
    old_lt_flag: data.forcefield === "martini3 lipidome" ? "" : "--old-lt",
    mol_name: basename(data.itp.name, extname(data.itp.name)),
  };
  console.log(exportVar);

  try {
    logger.debug("[socket:ComputationApi::generate_insane_defs] Running...");
    const { stdout } = await Executor.run("insane_def_builder", {
      exportVar,
      inputs,
    });

    console.log(stdout); // JSON InsaneDefs
    return stdout;
  } catch (job: any) {
    //JobOptProxy

    logger.error(job.id, job.stderr);

    throw new Error(JSON.stringify({ error: data.itp.name }));
  }
};
