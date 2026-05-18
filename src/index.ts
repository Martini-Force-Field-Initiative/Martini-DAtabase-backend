import dotenv from "dotenv";
const conf = dotenv.config({ path: __dirname + "/../.env" });
if (conf.error) {
  console.error("Error while loading conf. Verify or create .env file");
  console.error(
    "Stack trace:",
    "stack" in conf.error ? conf.error : conf.error,
  );
  process.exit(2);
}

import { inspect } from "util";
import express from "express";
import commander from "commander";
import { VERSION, URLS, DEFAULT_TMP_BASE_DIR, MAINTENANCE } from "./constants";
import logger, { toggleLogToFile } from "./logger";
import { ApiRouter } from "./controllers/routes";
import ApiSocket from "./controllers/sockets";
import Errors, { ErrorType, ApiError } from "./Errors";
import { sendError } from "./helpers/simple";
import { Database } from "./Entities/CouchHelper";
import MOLECULE_CLI from "./cli/molecule_cli";
import USER_CLI from "./cli/user_cli";
import { CLI } from "./cli/cli";
import MAIL_CLI from "./cli/mail_cli";
import StaticServer from "./controllers/static_server";
import CliHelper from "mad-cli";
import DATABASE_CLI from "./cli/databases_cli";
import TmpDirHelper from "./TmpDirHelper";
import TEST_CLI from "./cli/test.cli";
import http from "http";
import MoleculeOrganizer from "./MoleculeOrganizer";
import { HTTP_trace } from "./controllers/httpMonitor";
import ForceFieldStore from "./Stores/ForceFieldStore";
import SettingsWrapper from "./helpers/settingsManager";
import LipidStore from "./Stores/LipidStore";
import PolyplyStore from "./Stores/PolyplyStore";
import LibraryStore from "./Stores/Bibliography";

commander
  .version(VERSION)
  .option(
    "-c, --couchdb-url <url>",
    "Couch DB URL",
    String,
    process.env.COUCHDB_HOST || URLS.COUCH,
  )
  .option(
    "--server-url <url>",
    "Server URL",
    String,
    process.env.SERVER_URL || URLS.SERVER,
  )
  .requiredOption("--lib-tag <lib_tag>", "Forcefield files library", String)
  .option("-p, --port <port>", "Emit port", Number, 4123)
  .option("--cache-ttl <ttl>", "Max time to keep cache in minutes", Number, 45)
  .option(
    "--cache-interval <interval>",
    "Frequency of cache cleaning minutes",
    Number,
    30,
  )
  .option("--server", "Run in web service infrastructure")
  .option(
    "--os-tmp",
    "Use automatic OSes temporary directory manager instead of " +
      DEFAULT_TMP_BASE_DIR +
      " base directory",
  )
  // Wipe & init options are disable b/c no Namespace managment implemented
  //.option('--wipe-init')
  //.option('--init-db')
  //.option('--quit-after-init')
  .option("--keep-cache", "Don't delete tmp cache directory after 45 min")
  .option(
    "-l, --log-level <logLevel>",
    "Log level [debug|silly|verbose|info|warn|error]",
    /^(debug|silly|verbose|info|warn|error)$/,
    "info",
  )
  .option("--log-file <logFile>", "Logging file")
  .option(
    "--maintenance",
    "maintenance mode with no display of database molecules",
  )
  .requiredOption("--ns <dbPrefix>", "set databases prefix (optional)", String)
  .option(
    "--http-trace-file <logFile>",
    "Log all http incoming requests into specified file",
  )
  .option("--cli-only", "Only connect to DB namespace, don't start the server")
  .option("--nocli", "Run without the cli (will fail on 1st time startup)")
  .option("--no-live-version", "Skip services version setup at startup")
  .parse(process.argv);

const app = express();

/* ------------------ */
/* - PARSE CLI ARGS - */
/* ------------------ */

// Log level
if (commander.logLevel) logger.level = commander.logLevel;

if (commander.osTmp) {
  TmpDirHelper.mode = "os";
} else {
  TmpDirHelper.mode = "directory";
}

//logger.silly(`Using ${Executor.mode} as running mode.`);
logger.silly(
  `Using ${TmpDirHelper.mode === "os" ? "os tmp dir manager" : "custom tmp directory"} as base for creating temporary directories.`,
);

// Log files
if (commander.logFile) toggleLogToFile(commander.logFile);

// CouchDB options
// DB prefix
const NS = commander.ns;
Database.setNamespace(NS);
MoleculeOrganizer.setNamespace(NS);
CLI.promptString = `${NS}>`;

//url/passwords
if (commander.couchdbUrl) {
  let url = commander.couchdbUrl;

  if (!url.startsWith("http://")) {
    if (process.env.COUCHDB_USER) {
      url =
        "http://" +
        process.env.COUCHDB_USER +
        ":" +
        process.env.COUCHDB_PASSWORD +
        "@" +
        url;
    } else {
      url = "http://" + url;
    }
  }

  Database.refresh(url);
  URLS.COUCH = url;
}

// Init options
if (commander.wipeInit) {
  logger.info("Wiping databases and creating them again");
  Database.wipeAndCreate().then(() => {
    if (commander.quitAfterInit) {
      logger.info("Exiting.");
      process.exit(0);
    }
  });
}

if (commander.initDb) {
  logger.info("Creating all databases");
  Database.createAll().then(() => {
    if (commander.quitAfterInit) {
      logger.info("Exiting.");
      process.exit(0);
    }
  });
}

if (commander.maintenance) {
  logger.info("Maintenance mode");
  MAINTENANCE.mode = true;
}

/* ------------------------------ */
/* - STARTING EXPRESS ENDPOINTS - */
/* ------------------------------ */

// Register API router
app.use("/api", ApiRouter);

// Catch API errors
app.use(
  "/api",
  (err: any, req: express.Request, res: express.Response, next: Function) => {
    logger.error("api error :", err);
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err.name === "UnauthorizedError") {
      logger.debug("Token identification error: " + err.name);
      Errors.send(ErrorType.TokenInvalid, res);
    } else if (err instanceof ApiError) {
      sendError(err, res);
    }
    // @ts-ignore Invalid field in request
    else if (req.field) {
      // @ts-ignore
      Errors.send(ErrorType.Format, res, { field: req.field });
    } else {
      next(err);
    }
  },
);

app.use(StaticServer);
const HTTP_SERVER = http.createServer(app);
if (commander.httpTraceFile) HTTP_trace(HTTP_SERVER, commander.httpTraceFile);

ApiSocket.bind({ http: HTTP_SERVER });

// Check for ressources eventually early exiting if no cli is asked
async function startupRessCheck() {
  try {
    const db_exists = await Database.link
      .use(Database.addr.user)
      .info()
      .catch((e) => ({ not_found: true }));
    if ("not_found" in db_exists) {
      logger.error(
        '\nWARN: The database seems to be un-initialized. Please create all databases by entering "database create all".',
      );
      logger.error(
        'WARN: Once database is created, you can create an administrator account with "user create".',
      );
      throw "not_found_ressources";
    }

    const user_db = await Database.user.find({ selector: { role: "admin" } });
    if (!user_db.length) {
      logger.warn(
        '\nWARN: Server doesn\'t seem to have an administrator account created. You can create an user with "user create".',
      );
      throw "not_found_admin";
    }
  } catch (e) {
    if (commander.nocli) {
      logger.error(
        'You must run the 1st time startup without the "--nocli" option',
      );
      process.exit();
    }
  }
  // Checking Force field and lipid stores
  try {
    const _sw = await SettingsWrapper.getSettingsWrapper({
      noLiveVersion: commander.noLiveVersion,
    });

    await LibraryStore.setStore();
    const L_TAG = commander.libTag;
    await ForceFieldStore.setStore(L_TAG);
    const _ = ForceFieldStore.getStore();
    await PolyplyStore.setStore(_.polyplyEnvironments);
    await LipidStore.setStore(_.insaneForceFieldDefFile);
  } catch (e) {
    logger.error(
      `Could not instanciate Settings, ForceFieldStore, LipidStore or PolyplyStore: ${e}`,
    );
    process.exit(1);
  }
}

/* -------------------------- */
/* - COMMAND LINE INTERFACE - */
/* -------------------------- */
async function startCli() {
  const old_onclose = CLI.onclose.bind(CLI);

  CLI.onclose = async function () {
    await TmpDirHelper.clean();

    // this => attached to CLI; Should be fine
    old_onclose();
  };

  // Cli starter
  CLI.command("exit", async () => {
    CLI.onclose();
    process.exit(0);
  });

  CLI.command("molecule", MOLECULE_CLI);
  CLI.command("user", USER_CLI);
  CLI.command("mail", MAIL_CLI);
  CLI.command("database", DATABASE_CLI);
  CLI.command("test", TEST_CLI);

  CLI.command(
    /^(\?|help)$/,
    CliHelper.formatHelp("Martini Database Server", {
      commands: {
        molecule: "Access and manage published / stashed molecules.",
        user: "Manage existing users, or create new ones.",
        worker: "View started search workers and kill existing instances.",
        mail: "Send test e-mails from defined templates.",
        database: "Create and wipe Couch databases.",
        exit: "Stop the server.",
      },
    }),
  );

  logger.info('\nWelcome to Martinize server CLI. For help, type "help".');
  CLI.listen();
}

/* -------------------------------------- */
/* - HANDLE UNCATCHED REJECTED PROMISES - */
/* -------------------------------------- */

function propertiesValues(obj: any) {
  const data = Object.getOwnPropertyDescriptors(obj);

  for (const key in data) {
    data[key] = data[key].value;
  }

  return data;
}

process.on("unhandledRejection", (reason) => {
  const maximum_detail =
    typeof reason === "object" && reason !== null
      ? JSON.stringify(propertiesValues(reason), null, 2)
      : reason
        ? reason
        : "No rejection content.";

  logger.error(
    "Unhandled rejected Promise handled: \n" + String(maximum_detail),
  );
});

/* ------------------------------------------------- */
/* - STARTING THE SERVER AND LISTENING TO REQUESTS - */
/* ------------------------------------------------- */

async function main() {
  try {
    if (!commander.keepCache)
      await TmpDirHelper.program_clean(
        commander.cacheTtl,
        commander.cacheInterval,
      );
    await Database.ping();
  } catch (e: any) {
    logger.error(
      "CouchDB is not running or is unreachable. You must start Couch or specify a valid database URL.",
    );
    logger.error("Stack trace:", "stack" in e ? e.stack : e);
    logger.error(e);
    process.exit(2);
  }
  logger.info("CouchDB is running and reachable. Setting up MAD stores...");

  await startupRessCheck();
  const sw = await SettingsWrapper.getSettingsWrapper();
  if (commander.cliOnly) {
    logger.info("Only starting Command Line interface");
    startCli();
  } else {
    HTTP_SERVER.listen(commander.port, () => {
      logger.info(
        `Martini Database Server [ns@${commander.ns}:lib@${commander.libTag}] v${VERSION} is listening on port ${commander.port}.\n` +
          `Services Versions are:\n${inspect(sw.serviceVersions)}\n`,
      );
      if (commander.nocli)
        logger.info("The Server is running in nocli // passive mode");
      else startCli();
    });
  }
}

(async () => await main())();
