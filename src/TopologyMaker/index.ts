// Currently empty
// /*
//
// 1/ ForceField Key gives sequence
// 2/ virtualTypesITps: if any append right after initial itp sequence
//  Three topology generation contexts:
// Martinize : src/Builders/Martinizer/createTopFile
// MembraneBuilder: src/Builders/MembraneBuilder/generateTopology
// Polyply: src/controllers/sockets/polymerGenerator/polyplyUtils.ts:generateTopology
// */

/*
  For now we collect topology generation logics
  We'll see for eventual refactoring/class scoping later
*/

import path from "path";
import { Transform, Readable } from "stream";
import fs, { promises as FsPromise } from "fs";
import { TopologyConsumer, TopologyMakerParams, isConsumer } from "./types";

import logger from "../logger";

import {
  InputTextWrapper,
  readableToFile,
  readableToString,
  stringToStream,
} from "../helpers/inputs";

import ForceFieldStore from "../Stores/ForceFieldStore";

export default class TopologyMaker {
  private ffStore: ForceFieldStore;
  private parameters: TopologyMakerParams;

  public static async createTopFile(
    params: TopologyMakerParams,
  ): Promise<Readable> {
    /*Maybe set polyply/martinizer/insane here ???*/
    const ffs = ForceFieldStore.getStore();
    if (!isConsumer(params.consumer))
      throw new Error(`TopologyMaker: unknown consumer '${params.consumer}'`);

    const tpo = new TopologyMaker(ffs, params);
    // Choosing here for reader's clarity

    if (params.consumer === "martinize") return tpo.createMartinizeTopFile();

    throw new Error("TopologyMaker membrane builder and polyply to impment");
    //if (params.consumer === "polyply") return tpo.createPolyplyTopFile();
  }

  private constructor(
    ffStore: ForceFieldStore,
    parameters: TopologyMakerParams,
  ) {
    this.ffStore = ffStore;
    this.parameters = parameters;
  }

  async createInsaneTopFile(): Promise<Readable> {
    throw new Error("TOP INSANE TO DO");
  }
  // Simple copy of Martinizer.createTopFile for now
  async createMartinizeTopFile(): Promise<Readable> {
    const logPfx = `[TopologyMaker:createMartinizerTopFile (${this.parameters.consumer})]`;
    logger.debug(`${logPfx} starting...`);

    const {
      srcTopology,
      forcefield,
      itpsPath,
      linkTargetDir,
      excludedItps = [
        "VirtGoSites.itp",
        "go4view_harm.itp",
        "go_nbparams.itp",
        "go_atomtypes.itp",
      ],
      excludedItpsExtra = [],
      excludedItpsExtraByRegExp = [],
      excludedDefine = [],
    } = this.parameters;

    let inputTop = undefined;
    if (srcTopology) inputTop = InputTextWrapper(srcTopology);

    let itps_ff: string[] = this.ffStore.getFilesForForceField(forcefield);
    if (itps_ff.length == 0) {
      logger.error(`${logPfx} unknown forcefield '${forcefield}'`);
      throw new ReferenceError(
        `Your force field is invalid: can't find related ITPs.`,
      );
    }

    logger.debug(
      `${logPfx} related forcefield (${forcefield}) ITPS : ${itps_ff}`,
    );
    logger.debug(`${logPfx} itpsPath  ITPS : ${itpsPath ? itpsPath : []}`);
    // Eventually merge provided itpsPath
    const mergedItpPaths =
      //[ ...itps_ff.map(ffStore.anyForceFiedFileAbsPath), ...(itpsPath?itpsPath:[])];
      [
        ...this.ffStore.getCompleteFilesForForceField(forcefield),
        ...(itpsPath ? itpsPath : []),
      ];
    const mergedItpBasename = mergedItpPaths.map((p) => path.basename(p));

    logger.debug(
      `${logPfx} mergedItpBasename :\n\t${mergedItpBasename.join("\n\t")}`,
    );
    logger.debug(
      `${logPfx} mergedItpPaths :\n\t${mergedItpPaths.join("\n\t")}`,
    );

    if (linkTargetDir) {
      logger.debug(`${logPfx} Creating all symlink`);
      // Create everysym link
      await Promise.all(
        mergedItpPaths.map(async (itp_path, i) => {
          const dest = path.resolve(linkTargetDir + "/" + mergedItpBasename[i]);
          try {
            await FsPromise.symlink(itp_path, dest);
          } catch (e) {
            const err = e as any;
            if (err.code === "EEXIST")
              logger.verbose(`${logPfx} ${itp_path} symlink already exists`);
            else throw new Error(err);
          }
        }),
      );
    }
    const includes: string[] = [];
    // Define the includes
    const toExclude = excludedItps.concat(excludedItpsExtra);
    const toExcludeRegExp: RegExp[] = excludedItpsExtraByRegExp.map(
      (s: string) => new RegExp(s),
    );
    logger.debug(
      `${logPfx} Generating the actual include statements for :\n ${mergedItpBasename}\n` +
        `against black-list(s):\n\t${toExclude}\n\t${toExcludeRegExp}`,
    );

    const hasNewGoSites = TopologyMaker.GoInItpBasenames(mergedItpBasename);
    mergedItpBasename.forEach((itp, i) => {
      if (i == 1 && hasNewGoSites) {
        includes.push('#include "go_atomtypes.itp"');
        includes.push('#include "go_nbparams.itp"');
      }

      //for (const itp of mergedItpBasename) {
      logger.debug(`${logPfx} Exclusion check of ${itp}`);
      // Exclude the GO ITPs, they're already included in martini_304.itp
      if (
        toExclude.reduce(
          (isOut, exclItp) => isOut || itp.endsWith(exclItp),
          false,
        )
      ) {
        logger.debug(
          `${logPfx} Not including this itp (GO Itp like, which should be included in martini_304.itp) : ${itp}`,
        );
        return;
      }
      if (
        toExcludeRegExp.reduce((isOut, regExpToExclItp) => {
          logger.debug(`DD: ${regExpToExclItp} vs ${itp}`);
          return isOut || regExpToExclItp.test(itp);
        }, false)
      ) {
        logger.debug(
          `${logPfx} Not including this itp that matches regexp exclusion rule ${excludedItpsExtraByRegExp} : ${itp}`,
        );
        return;
      }
      includes.push(`#include "${itp}"`);
    });

    logger.debug(
      `${logPfx} itp include statements :\n\t${includes.join("\n\t")}`,
    );
    logger.debug(
      `${logPfx} source is \"${
        srcTopology == undefined
          ? "undefined"
          : typeof srcTopology === "string"
            ? "string"
            : "Readable"
      }\"`,
    );

    if (inputTop == undefined) {
      logger.debug(`${logPfx} Output genuine topology file`);
      return InputTextWrapper(includes.join("\n") + "\n", false);
    }

    logger.debug(`${logPfx} Transforming a previous topology file`);

    /* Merging itp references
      itp_stream may hold references to forcefield fields
      supplied itp may hold references to forcefield fields
      output stream must refence forcefields files first.

      We do it shallow (ie:not looking inside files for additional itp refs)
      if include statement is ff_file which has not been encounterd we append to includes
      if include statemtement is not a ff_file _______________________ push _____________

      We use the command first comment statemnt line to dump #include and #define
    */
    const extractItpFileName = (line: string): string => {
      const re = /^#include[\s]+["']([^"^']+)["']/;
      const m = re.exec(line);
      if (m) return m[1];
      logger.warn(
        'extractItpFileName: no itp reference found in input line "${line}"',
      );
      return "";
    };

    const ItpTransform = new Transform({
      transform(chunk, encoding, callback) {
        // local should be enough, alternative is implement class extending transform w/ includes_included attribute
        let include_done = false;
        const buffer = chunk.toString().split("\n");
        let output: string = "";
        const toDefine: string[] = [];

        const toInclude = includes;

        logger.debug(
          `${logPfx} following itp(s) will be included:\n\t${toInclude.join("\n\t")}`,
        );
        //toInclude = toInclude.filter((v) => !)
        buffer.forEach((line: string) => {
          logger.debug(`${logPfx} Original Topology features line:: ${line}`);
          if (line.startsWith('#include "martini.itp"')) {
            // the autogenerated include statement
            logger.debug(
              `${logPfx} Skipping autogenerated \"martini.itp\" include`,
            );
            return;
          }
          if (line.startsWith(";")) {
            // comment sections
            output += line + "\n";
            return;
          }

          if (line.startsWith("#define")) {
            //logger.debug("WWWW" + line + " VS " + excludedDefine)
            if (excludedDefine.indexOf(line) < 0) toDefine.push(line);
          }

          if (line.startsWith("#include")) {
            // consider current line as include
            //logger.debug( extractItpFileName(line) + " VS " + itps_ff);
            if (toExclude.includes(extractItpFileName(line))) {
              logger.debug(
                `${logPfx} ${line} is to be excluded (ExactName Excl)`,
              );
              return;
            }
            if (
              toExcludeRegExp.reduce(
                (isOut, regExpToExclItp) => isOut || regExpToExclItp.test(line),
                false,
              )
            ) {
              logger.debug(`${logPfx} ${line} is to be excluded (RegExp Excl)`);
              return;
            }

            if (!toInclude.includes(line)) {
              // if is not in set of currently registred includes
              logger.debug(
                `${logPfx} previous top line '${line}' not found in ${toInclude}`,
              );
              if (itps_ff.includes(extractItpFileName(line))) {
                // put 1st if basic ff file or last otherwise
                logger.debug(`${logPfx} prepending include: "${line}`);
                toInclude.unshift(line);
              } else {
                logger.debug(`${logPfx} appending include: "${line}`);
                toInclude.push(line);
              }
            }
            return;
          }

          if (line.startsWith("[") && !include_done) {
            // Dump includes with defines and the priority include @top
            //toInclude    = itpsPrioritySort(toInclude);
            output = toDefine.join("\n") + "\n";
            output += toInclude.join("\n") + "\n\n\n";
            include_done = true;
          }
          output += line + "\n";
        });
        if (!include_done)
          // in case only includes at every lines
          output = toInclude.join("\n") + "\n";
        logger.debug(`${logPfx} Output Topology features:\n ${output}`);

        callback(null, output);
      },
    });
    inputTop.pipe(ItpTransform);
    return ItpTransform;
  }

  static GoInItpBasenames(itpBaseNames: string[]) {
    const hasGoType = itpBaseNames.includes("go_atomtypes.itp");
    if (hasGoType !== itpBaseNames.includes("go_nbparams.itp"))
      throw new Error(
        `Invalid Go sites include statement ${
          hasGoType ? "go_nbparams.itp" : "go_atomtypes.itp"
        } is missing`,
      );

    return hasGoType;
  }
}
