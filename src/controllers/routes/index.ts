import { Router } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import UserRouter from "./user";
import cookieParser from "cookie-parser";
import jwt from "./jwt";
import Errors, { ErrorType } from "../../Errors";
import MoleculeRouter from "./molecule";
import SettingsRouter from "./settings";
import polymerGeneratorRouter from "./polymergenerator";
import CitationRouter from "./citations";
import ModerationRouter from "./moderation";
import DownloadForceFieldRoute from "./force_fields/download";
import HistoryRouter from "./history";

export const ApiRouter = Router();
ApiRouter.use(cors());
ApiRouter.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));
ApiRouter.use(bodyParser.json({ limit: "50mb" }));
ApiRouter.use(cookieParser());

ApiRouter.use(jwt);

// Subscribe to sub routers
ApiRouter.use("/user", UserRouter);
ApiRouter.use("/molecule", MoleculeRouter);
ApiRouter.use("/settings", SettingsRouter);
ApiRouter.use("/moderation", ModerationRouter);
ApiRouter.use("/force_fields", DownloadForceFieldRoute);
ApiRouter.use("/history", HistoryRouter);
ApiRouter.use("/cite", CitationRouter);
// Maybe deprecated to test
ApiRouter.use("/polymer_generator", polymerGeneratorRouter);

// Catch all API invalid routes
ApiRouter.use(() => {
  Errors.throw(ErrorType.NotFound);
});

//export default ApiRouter;
