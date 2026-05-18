import { Router } from "express";
import {
  methodNotAllowed,
  cleanMulterFiles,
  dateFormatter,
} from "../../../helpers/simple";
import SettingsWrapper from "../../../helpers/settingsManager";

const MartinizerRouter = Router();

// Middleware that wipe uploaded files after request
MartinizerRouter.use((req, res, next) => {
  function after() {
    // Response is sended
    cleanMulterFiles(req);
    res.removeListener("finish", after);
  }

  res.once("finish", after);
  next();
});

MartinizerRouter.get("/version", async (req, res) => {
  const sw = await SettingsWrapper.getSettingsWrapper();
  res.json({ version: sw.serviceVersions.martinize2 });
});

MartinizerRouter.all("/version", methodNotAllowed("GET"));
MartinizerRouter.all("/", methodNotAllowed("POST"));

export default MartinizerRouter;
