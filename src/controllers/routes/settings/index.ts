import { Router } from "express";
import { errorCatcher, methodNotAllowed } from "../../../helpers/simple";
import Errors, { ErrorType } from "../../../Errors";

import ForceFieldStore from "../../../Stores/ForceFieldStore";
import LibraryStore from "../../../Stores/Bibliography";
import { inspect } from "util";
const SettingsRouter = Router();
import logger from "../../../logger";

import SettingsWrapper from "../../../helpers/settingsManager";
import LipidStore from "../../../Stores/LipidStore";

// Settings file "settings.json" at project root
SettingsRouter.get("/", async (_, res) => {
  /* Merge create_way and category_settings with forcefields properties
  ,
  /* SettingsWrapper doesn't handle force fields anymore.
    This is now managed by ForceFieldStore
  "force_fields": [
    "elnedyn",
    "elnedyn22",
    "elnedyn22p",
    "martini22",
    "martini22p",
    "martini3001",
    "martini23_CNP"
  ],
  "force_fields_info":{
    "elnedyn":{"polarizable": false, "type": "protein", "downloadable" : false},
    "elnedyn22":{"polarizable": false, "type": "protein", "downloadable" : false},
    "elnedyn22p":{"polarizable": true, "type": "protein", "downloadable" : false},
    "martini22":{"polarizable": false, "type": "supported", "downloadable" : true},
    "martini22p":{"polarizable": true, "type": "supported", "downloadable" : true},
    "martini3001":{"polarizable": false, "type": "supported", "downloadable" : true},
    "martini23_CNP" : {"polarizable": false, "type": "modified", "downloadable" : true}
  },
  */

  const ffStore = ForceFieldStore.getStore();
  const settings = await SettingsWrapper.getSettingsWrapper();
  const d = settings.asTree;
  const { force_fields, force_fields_info, vermouth_libs_info } =
    ffStore.generateClientSettings();
  d.force_fields_info = force_fields_info;
  d.force_fields = force_fields;
  d.vermouth_libs_info = vermouth_libs_info;
  logger.debug(`[SettingsRouter:get] force_fields[info] ${inspect(d)}`);
  res.json(d);
});

SettingsRouter.post("/", async (req, res) => {
  if (req.full_user?.role !== "admin") {
    Errors.throw(ErrorType.Forbidden);
  }

  if (typeof req.body !== "object") {
    return Errors.throw(ErrorType.Format);
  }
  const settings = await SettingsWrapper.getSettingsWrapper();

  (async () => {
    for (const prop in req.body) settings.update(prop, req.body[prop]);

    res.json(settings.asTree);
  })().catch(errorCatcher(res));
});

SettingsRouter.all("/", methodNotAllowed(["GET", "POST"]));

interface LipidForcefieldParams {
  ff: string;
  withCompatible: boolean;
}
SettingsRouter.get("/lipidModels", async (req, res) => {
  logger.debug(`[SettingsRouter:getLipids] ${inspect(req.query)}`);
  /**
   * We need to integrate coby lipids here
   *
   */

  let ff_params: LipidForcefieldParams | undefined;
  if (req.query.force_field) {
    ff_params = {
      ff: req.query.force_field as string,
      withCompatible: req.query.withCompatible === "true",
    };
  }

  const lipidStore = LipidStore.getStore();
  //const membraneBuilder = await MembraneBuilder.create();

  //logger.debug(inspect(membraneBuilder.SUPPORTED_LIPIDS))
  if (ff_params) {
    if (!ff_params.withCompatible) {
      // Just Get the collection of lipid of this specific ff
      logger.debug(`[SettingsRouter:getLipids] ${ff_params.ff}`);
      const lipidAliases = lipidStore.getSupportedLipidsAlias(ff_params.ff);
      logger.debug(`[SettingsRouter:getLipids] ${inspect(lipidAliases)}`);
      res.json(lipidAliases);
      return;
    }
    logger.debug(
      `[SettingsRouter:getLipids] ${ff_params.ff} and compatible ffs`,
    );
    // Get the collection of lipid of this specific ff and its compatible ffs
    const ffStore = ForceFieldStore.getStore();
    const d: { [k: string]: string[] } = {};
    d[ff_params.ff] = lipidStore.getSupportedLipidsAlias(ff_params.ff);
    for (const cmp_ff of ffStore.compatibleForceFieldsVector(ff_params.ff)) {
      d[cmp_ff] = lipidStore.getSupportedLipidsAlias(cmp_ff);
    }
    logger.debug(`[SettingsRouter:getLipids] ${inspect(d)}`);
    res.json(d);
    return;
  }

  // Any lipid is it used ?
  res.json(lipidStore.anySupportedLipidsAlias);
});

SettingsRouter.all("/lipids", methodNotAllowed(["GET"]));

export default SettingsRouter;
