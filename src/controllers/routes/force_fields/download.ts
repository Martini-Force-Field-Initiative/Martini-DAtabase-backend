import { Router } from "express";
import { errorCatcher } from "../../../helpers/simple";
import Errors, { ErrorType } from "../../../Errors";
import ForceFieldStore from "../../../Stores/ForceFieldStore";
import JSZip from "jszip";
import { promises as FsPromise } from "fs";
import { basename } from "path";
import logger from "../../../logger";

const DownloadForceFieldRoute = Router();

DownloadForceFieldRoute.get("/list", (_, res) => {
  const ffStore = ForceFieldStore.getStore();
  res.json(ffStore.availableForceFields);
});

DownloadForceFieldRoute.get("/download", (req, res) => {
  const name = req.query.name;

  (async () => {
    const ffStore = ForceFieldStore.getStore();

    if (!name || typeof name !== "string")
      return Errors.throw(ErrorType.MissingParameters);

    if (
      !ffStore.isAvailableForceField(name) &&
      !ffStore.isAvailableVermouthLib(name)
    )
      //return Errors.throw(ErrorType.InvalidVermouthLib);
      return Errors.throw(ErrorType.InvalidForceField);

    const filenames = ffStore.getCompleteFilesForForceFieldOrVermouthLib(name);
    const zip = new JSZip();

    if (typeof filenames === "string") {
      res.sendFile(filenames, {
        headers: {
          "Content-Disposition": "attachement; filename=" + filenames,
        },
      });
      return;
    }

    for (const file of filenames) {
      logger.debug(`[router:Download] Bundling ${file}...`);
      //@ts-ignore
      zip
        .folder("MAD_forcefields")
        .file(basename(file), await FsPromise.readFile(file));
    }

    const zip_buffer = await zip.generateAsync({
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      type: "nodebuffer",
    });

    res
      .status(200)
      .type("zip")
      .header("Content-Disposition", "attachement; filename=" + name + ".zip")
      .send(zip_buffer);
  })().catch(errorCatcher(res));
});

export default DownloadForceFieldRoute;
