import dotenv from "dotenv";
const conf = dotenv.config({ path: __dirname + "/../../.env" });
if (conf.error) {
  console.log("Error while loading conf. Verify or create .env file");
  console.log("Stack trace:", "stack" in conf.error ? conf.error : conf.error);
  process.exit(2);
}
import logger from "../logger";
logger.level = process.env.LOG_LVL as string;
import Executor from "../Builders/Executor";
//Executor.mode = "server";

import { expect } from "chai";
import { TmpDirHelper } from "../TmpDirHelper";
import TopologyMaker from "../TopologyMaker";
import { Martinizer } from "../Builders/Martinizer";
import { MartinizerTestHelpers } from "./data/MartinizerTestResults";
import { readableToString, fileStringContent } from "../helpers/inputs";
import { anyCoorAsTypeAndStream } from "../helpers/gmxUtils";
import { readFileSync } from "fs";
import { inspect } from "util";
import { io } from "socket.io-client";
import { resolve } from "path";

/* TODO GL 27/12
 1/ Elastic
 2/ Go
Combined with different contact map algorithms

*/

describe("Test suite:: [Martinizer]", function () {
  this.timeout(60000);
  const srcTopology = __dirname + "/data/data_submit/from_PDB/topol.top";
  const srcPdb = __dirname + "/data/data_submit/from_PDB/DAPA.pdb";
  const itpsPath = [__dirname + "/data/data_submit/from_PDB/DAPA.itp"];
  const forcefield = "martini3001";

  it(".1 Testing createTopFile from scratch", async () => {
    const linkTargetDir = await TmpDirHelper.get();
    const topOut = await TopologyMaker.createTopFile({
      consumer: "martinize",
      itpsPath,
      linkTargetDir,
      forcefield,
    });

    expect(await readableToString(topOut)).to.equal(
      MartinizerTestHelpers.createTopFileGenuine,
    );
  });
  it(".2 Testing createTopFile from a previous file", async () => {
    const linkTargetDir = await TmpDirHelper.get();
    const topOut = await TopologyMaker.createTopFile({
      consumer: "martinize",
      srcTopology,
      itpsPath,
      linkTargetDir,
      forcefield,
    });

    expect(await readableToString(topOut)).to.equal(
      MartinizerTestHelpers.createTopFilePrevious,
    );
  });
  it(".3 gmx:anyCoorAsTypeAndStream ... from stream", async () => {
    //const linkTargetDir = await TmpDirHelper.get();
    const [gro_or_pbb, coorStream] = await anyCoorAsTypeAndStream(srcPdb);
    logger.debug(`Guessed format \"${gro_or_pbb}\"`);
    logger.debug(await readableToString(coorStream));
  });

  it(".4 createPdbWithConect", async () => {
    const topContent = await fileStringContent(srcTopology);
    const { pdb, gro } = await Martinizer.createPdbWithConect(
      srcPdb,
      topContent,
      false,
      "simple_martini3001",
      itpsPath,
    );
    logger.debug(readableToString(gro));
  });
  it(".5 Martinize Basic...", async () => {
    const workDir = await TmpDirHelper.get();
    logger.debug(`Martinizer Basic output directory @${workDir}`);
    const baseSettings =
      await MartinizerTestHelpers.genMartinizeSettingsBasic();
    const { pdb, itps } = await Martinizer.run(baseSettings, workDir);
  });
  // This one does not work, socket io connection mess up
  it(".6 Martinize Virtual go sites...", async () => {
    const workDir = await TmpDirHelper.get();
    logger.debug(`Martinizer Virtual go sites output directory @${workDir}`);
    const vitualGoSettings =
      await MartinizerTestHelpers.genMartinizeSettingsBasic();
    const { pdb, itps } = await Martinizer.run(vitualGoSettings, workDir);
  });
});
