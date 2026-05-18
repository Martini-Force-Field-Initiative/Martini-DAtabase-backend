import fs, { promises as FsPromise } from "fs";
import TmpDirHelper from "../TmpDirHelper";
import { INSANE_HACK_SCRIPT } from "../constants";
import logger from "../logger";
import { Martinizer } from "./Martinizer";

import { Database } from "../Entities/CouchHelper";
import MoleculeOrganizer from "../MoleculeOrganizer";
import { ArrayValues } from "../helpers/simple";
import { Lipid } from "../Entities/entities";
import Executor, { ExecutorStartConnectionError } from "./Executor";
import Errors, { ErrorType } from "../Errors";
import ItpFile, { TopFile } from "itp_mad_parser";
import { Readable } from "stream";
import { inspect } from "util";
import { readableToString, stringToStream } from "../helpers/inputs";
import { ClientInputAPI, JobOptAPI } from "ms-jobmanager";
import ForceFieldStore from "../Stores/ForceFieldStore";
import LipidStore from "../Stores/LipidStore";
import DatabaseMoleculeDesk from "../helpers/database/molecule";
import { JobOptInputs } from "ms-jobmanager/shared/types/common/jobopt_model";

import TopologyMaker from "../TopologyMaker";

export const AvailablePbcStrings = [
  "hexagonal",
  "rectangular",
  "square",
  "cubic",
  "optimal",
  "keep",
] as const;
export type PbcString = ArrayValues<typeof AvailablePbcStrings>;
export const checkPbc = (pbc: string): pbc is PbcString => {
  return AvailablePbcStrings.includes(pbc as any);
};

export const AvailableRotateTypes = ["random", "princ", "angle"] as const;
export type RotateString = ArrayValues<typeof AvailableRotateTypes>;

export interface InsaneSettings {
  pbc: PbcString;
  /** Box size: Must be an array of 3, 6 or 9 integers. */
  box: number[];
  area_per_lipid?: number;
  area_per_lipid_upper?: number;
  random_kick_size?: number;
  bead_distance?: number;
  center?: boolean;
  orient?: boolean;
  rotate?: RotateString;
  rotate_angle?: number;
  grid_spacing?: number;
  hydrophobic_ratio?: number;
  fudge?: number;
  shift_protein?: number;
  charge?: number;
  salt_concentration?: number;
  solvent_type?: string;
}

// @ts-ignore
const InsaneParamToCliArg: { [T in keyof InsaneSettings]: string } = {
  pbc: "-pbc",
  area_per_lipid: "-a",
  area_per_lipid_upper: "-au",
  random_kick_size: "-rand",
  bead_distance: "-bd",
  center: "-center",
  orient: "-orient",
  grid_spacing: "-od",
  hydrophobic_ratio: "-op",
  fudge: "-fudge",
  shift_protein: "-dm",
  charge: "-charge",
  salt_concentration: "-salt",
  solvent_type: "-sol",
};

export interface InsaneRunnerOptions {
  force_field: string;
  molecule_pdb?: string;
  molecule_top?: string;
  molecule_itps?: string[];
  lipids?: LipidMap;
  upper_leaflet?: LipidMap;
  settings?: Partial<InsaneSettings>;
}

type SimpleLipidMap = [string, number][];
export type LipidMap = SimpleLipidMap | string[];

export interface InsaneResults {
  itps: string[];
  pdbWater: Readable;
  pdbNoWater?: Readable;
  top: Readable;
}

export class MembraneBuilder {
  //readonly SUPPORTED_LIPIDS: { [prefix: string]: string[] } = {};
  //readonly LIPIDS_DEF_FILES: { [prefix: string]: string }   = {};

  public static /*async*/ create() {
    const MB = new MembraneBuilder();
    //const lipidStore = LipidStore.getStore();

    // Init the supported lipids
    // We filter lipids which are not in the database
    // For now we are doing it the dumb way
    // Not paying attention to ff cross compatibility

    // TODO_0307 Move this to LipidStore
    //  Objectives of LipidStore: insane_ff coupling. getLipidItps
    /*
    for (const [ff, fPath] of ffStore.insaneForceFieldDefFile) {
      try {
        logger.debug(`MembraneBuilder:: Reading ${ff} lipid definitions from ${fPath}`);
        const insane_def_data = JSON.parse(await readFile(fPath, 'utf8'));
        MB.LIPIDS_DEF_FILES[ff] = fPath;
        MB.SUPPORTED_LIPIDS[ff] = [];
        for (const type in insane_def_data)
            for( const lipidAlias in insane_def_data[type].a) {
            const _ = await DatabaseMoleculeDesk.isForceFieldSupported(lipidAlias, ff);
            if(_)
                MB.SUPPORTED_LIPIDS[ff].push(lipidAlias);
            else
              logger.warn(`Could not find lipid ${lipidAlias} in database for force field ${ff}`);
            }
      } catch (err) {
        throw new Error(`Error reading INSANE ${ff} definition file ${err}`);
      }
    }
    logger.debug(`[MembraneBuilder:Supported lipids] ${inspect(MB.SUPPORTED_LIPIDS)}`);
    */

    return MB;
  }
  private constructor() {}

  /**
   * Build a membrane using INSANE.
   *
   * Steps:
   * - With the given molecule (PDB+ITPs), selected force field and the defined lipids in parameter, generate a GRO box with INSANE
   * - Include the required ITPs (lipid-specific + force field + xxx.itp of the given molecule) in a newly created topology file
   * - Generate a PDB with CONECT entries using `Martinizer.createPdbWithConect()` function
   * - Returns TOP, PDB and ITPs file locations
   */
  async run({
    force_field,
    molecule_pdb,
    molecule_top,
    molecule_itps,
    lipids,
    upper_leaflet = [],
    settings = {},
  }: InsaneRunnerOptions): Promise<InsaneResults> {
    logger.info("MembraneBuilder.run: [INSANE]");
    logger.info(`ff ${force_field}, pdb ${molecule_pdb}, top ${molecule_top}`);
    logger.info(
      `itps ${molecule_itps}, lipids ${lipids}, upper leaflet ${upper_leaflet}`,
    );

    const ffStore = ForceFieldStore.getStore();
    const lipidStore = LipidStore.getStore();

    let ff_location = ffStore.getFilesForForceField(force_field);
    if (!ff_location) {
      throw new Error("Unknown force field. Please select a good force field");
    } else if (typeof ff_location === "string") {
      ff_location = [ff_location];
    }

    let lipid_param: SimpleLipidMap = [];
    let upper_lipid_param: SimpleLipidMap = [];

    if (lipids) {
      if (!lipids.length) {
        throw new Error("You need at least one lipid to insert.");
      }

      // If string[], convert to [string, 1][]
      lipid_param =
        typeof lipids[0] === "string"
          ? (lipids as string[]).map((e) => [e, 1])
          : (lipids as SimpleLipidMap);

      // Same for upper leaflet
      upper_lipid_param =
        upper_leaflet.length && typeof upper_leaflet[0] === "string"
          ? (upper_leaflet as string[]).map((e) => [e, 1])
          : (upper_leaflet as SimpleLipidMap);

      /// WITH DATABASE
      // Download every lipid
      // const lipids_entities = await Database.lipid.getAndThrowIfMissing([...lipid_param, ...upper_lipid_param].map(e => e[0]), force_field);

      /// WITH FILES
      // Check if every lipid is supported
      const supported_ff_lipids =
        lipidStore.getSupportedLipidsAlias(force_field);
      if (
        !lipid_param.every((l) => supported_ff_lipids.includes(l[0])) ||
        !upper_lipid_param.every((l) => supported_ff_lipids.includes(l[0]))
      ) {
        // unsupported lipid
        throw new Error("Unsupported lipid.");
      }
    }

    // Get a tmp dir
    const workdir = await TmpDirHelper.get();

    logger.debug(`[INSANE] Starting a INSANE run in directory ${workdir}.`);

    // Register all options
    const options: InsaneSettings = Object.assign(
      {
        pbc: "square",
        box: [7, 7, 9],
      },
      settings,
    );

    logger.debug(`[INSANE] Options: ` + JSON.stringify(options, null, 2));

    // Check if box size is valid
    if (![3, 6, 9].includes(options.box.length)) {
      throw new Error("Box has unsupported number of dimensions.");
    }
    // Initialize command line with lipids definition file
    let command_line = `-d input/lipid_definitions.json `;
    // Build the command line with fixed options (or that requires treatment)
    if (molecule_pdb !== "") {
      command_line += `-f "${molecule_pdb}" `;
    }
    // Output files (system and topology)

    //command_line += "-o system.gro -p __insane.top " +
    // Box size
    command_line += `-box ${options.box.map((e) => Math.trunc(e)).join(",")} `;
    // Add all the lipids
    if (lipids) {
      // Lower leaflet/both leaflets if -u is missing
      //@ts-ignore
      command_line +=
        `-l ${lipid_param.map((e) => `${e[0]}:${e[1]}`).join(" -l ")} ` +
        // Upper leaflet (if defined)
        //@ts-ignore
        (upper_lipid_param.length
          ? `-u ${upper_lipid_param.map((e) => `${e[0]}:${e[1]}`).join(" -u ")} `
          : "");
    }

    if (options.rotate) {
      if (options.rotate === "angle") {
        command_line += `-rotate ${options.rotate_angle} `;
      } else if (AvailableRotateTypes.includes(options.rotate)) {
        command_line += `-rotate ${options.rotate} `;
      }
    }

    // Add every supported item
    for (const opt in options) {
      const o = opt as keyof InsaneSettings;
      if (!(opt in InsaneParamToCliArg) || options[o] === undefined) {
        // Unsupported or invalid option
        continue;
      }

      if (typeof options[o] === "boolean") {
        command_line += `${InsaneParamToCliArg[o]} `;
      } else {
        command_line += `${InsaneParamToCliArg[o]} ${options[o]} `;
      }
    }

    const jobOpt: JobOptAPI = {
      exportVar: {
        basedir: workdir,
        insaneArgs: command_line,
        gro_out: "system.gro",
        top_out: "__insane.top",
      },
      inputs: {
        "lipid_definitions.json":
          lipidStore.getInsaneLipidDefinitionFile(force_field),
      },
    };

    if (molecule_pdb)
      jobOpt.inputs = {
        ...jobOpt.inputs,
        "insaneHackBefore.py": INSANE_HACK_SCRIPT.BEFORE,
        "insaneHackAfter.py": INSANE_HACK_SCRIPT.AFTER,
        "input.pdb": molecule_pdb,
      } as JobOptInputs;

    // Start insane
    let insane_top_content: string;
    let gro_results_stream: Readable;
    try {
      logger.info(`[INSANE] sent to JM  with options:\n${inspect(jobOpt)}`);
      const { stdout, jobFS } = await Executor.run("insane", jobOpt);
      insane_top_content = await jobFS.readToString("__insane.top");
      gro_results_stream = molecule_pdb
        ? await jobFS.readToStream("system-insane-hack.gro")
        : await jobFS.readToStream("system.gro");
      logger.info(`[INSANE] job ${jobFS.job.id} ended`);
      logger.info(`jobFS list:\n${await jobFS.list("*")}`);
      //await ShellManager.run('insane', ShellManager.mode == "jm" ? jobOpt : `${INSANE_HACK_SCRIPT.BEFORE} ${INSANE_HACK_SCRIPT.AFTER} ${molecule_pdb} ${command_line}`, workdir, "insane");
    } catch (e: any) {
      // Handle error and throw the right error
      logger.error(`[INSANE] job crash message:\n${e.message}`);
      if (e instanceof ExecutorStartConnectionError) {
        logger.error(`[INSANE] JM connection error?: ${e.message}`);
        return Errors.throw(ErrorType.JMError, { error: e.message });
      }
      throw new InsaneError(
        "insane_crash",
        "error" in e ? e.error.stack : e.stack,
      );
    }

    // Create the new TOP file

    /*
    > merge includes of a full top file create with createTopFile() system+molecules and molecules from insane.top (except "Protein")
    > Inject ITPs of lipids (todo...) they should be available in server
    File with modifications: __prepared.top

    Compile with gromacs script
    ~/Prog/martinize-db/utils/create_conect_pdb.sh system.gro __prepared.top "/Users/alki/Prog/martinize-db/utils/run.mdp" --remove-water
    */

    logger.info(`[INSANE] Creating TOP file.`);
    /*
    If we have a _rubber_band.itp, don't include it in the top file because
    it's included in molecule_x.itp. Also need to have a molecule_x.itp without
    this included itp to compute pdb without elastic bonds in conect fields.
    */

    const itps_for_top = molecule_itps?.filter(
      (itp) => !itp.includes("_rubber_band"),
    );
    logger.info("itps", itps_for_top);

    let itps_without_elastic: string[] = [];
    if (itps_for_top && itps_for_top?.length != molecule_itps?.length) {
      //We have elastic bonds, so filter "#include" statements and write new *_without_elastic.itp
      for (const itp of itps_for_top) {
        const readedItp = await ItpFile.read(itp);
        const bonds = readedItp.getField("bonds");
        const bonds_without_included_elastic = bonds.filter(
          (line) =>
            !(line.startsWith("#include") && line.includes("_rubber_band")),
        );
        if (bonds.length !== bonds_without_included_elastic.length)
          logger.warn(
            "[INSANE] It seems *_rubber_band.itp exists but is not included inside molecule_*.itp",
          );
        readedItp.setField("bonds", bonds_without_included_elastic);
        const itpPath = workdir + "/" + readedItp.type + "_without_elastic.itp";
        fs.writeFileSync(itpPath, readedItp.toString());
        itps_without_elastic.push(itpPath);
      }
    }

    let noElasticTop: Readable | undefined = undefined;
    let fullTop: Readable;
    logger.debug(`[INSANE] include ITPs complete:${itps_for_top}`);
    logger.debug(`[INSANE] include ITPs w/o elastic:${itps_without_elastic}`);

    try {
      fullTop = await TopologyMaker.createTopFile(
        {
          consumer: "martinize",
          linkTargetDir: workdir,
          srcTopology: molecule_top,
          itpsPath: itps_for_top,
          forcefield: force_field,
        }, //  "original.top"??
      );
      //await readableToFile(originalTop, `${workdir}/original.top`);
      if (itps_without_elastic.length > 0)
        noElasticTop = await TopologyMaker.createTopFile({
          consumer: "martinize",
          linkTargetDir: workdir,
          srcTopology: molecule_top,
          itpsPath: itps_without_elastic,
          forcefield: force_field,
        });
    } catch (e: any) {
      throw new InsaneError("top_file_crash", e.stack);
    }

    /* GL put comment 21/12 can be commented in to check with temp var name corrections
    and intermediary files checking

    logger.info(`[INSANE] Reading built TOP file at ${full_top}`);
    logger.info(`[INSANE] Reading INSANE generate TOP following string \"${insane_top_content}\"`);
    */
    const insaneTopFile = TopFile.readFromString(insane_top_content);

    /*
    logger.info(`[INSANE] Reading INSANE generate TOP content:\n${insane_top}`);

    fs.access(full_top, (error) => {
      //  if any error
      if (error) {
        console.log(error);
        return;
      }

      logger.info(`[INSANE] TopFile ${full_top} exists`);
      fs.readFile(full_top, (e,d)=> logger.info(`[INSANE] TopFile content is \n${d}`));
    });


    logger.info(`[INSANE] Calling TopFile.read(${full_top}) !!!`);
    const molecule_full_top = await TopFile.read(full_top);



    const readed_wo_elastic_top = wo_elastic_top ? await TopFile.read(wo_elastic_top) : undefined
    */
    const fullTopFile = TopFile.readFromString(await readableToString(fullTop));
    let noElasticTopFile: TopFile | undefined = undefined;
    if (noElasticTop)
      noElasticTopFile = TopFile.readFromString(
        await readableToString(noElasticTop),
      );
    //logger.info(`[INSANE] Base (full) topology read from ${full_top} features object:${inspect(molecule_full_top)}`);
    //logger.info(`[INSANE] top object headlines : ${molecule_full_top.headlines}`);
    if (lipids) {
      // Compile the top files
      // Includes are normally all resolved in molecule_full_top (with the force field !)
      // We need to includes also the lipids ITPs
      //@ts-ignore
      const lipids_itp_names = this.getUniqueLipids(
        lipid_param,
        upper_lipid_param,
      ).map((e) => e + ".itp");

      // Add the includes at the end of headlines
      fullTopFile.headlines.push(
        ...lipids_itp_names.map((e) => `#include "${e}"`),
      );
      if (noElasticTopFile)
        noElasticTopFile.headlines.push(
          ...lipids_itp_names.map((e) => `#include "${e}"`),
        );
    }

    // Compile the top files together
    logger.info(`[INSANE] Writing prepared TOP file.`);

    const prepared_top = await this.getPreparedTopFile(
      insaneTopFile,
      fullTopFile,
    );
    const prepared_top_wo_elastic = noElasticTopFile
      ? await this.getPreparedTopFile(insaneTopFile, noElasticTopFile)
      : undefined;

    // Create lipids ITP files in working dir.
    // FF(s) symlink has been created by createTopFile() method.
    // + symlink of the molecule ITPs (needed)
    logger.debug(`[INSANE] Creating files for lipids ITPs.`);

    // Ok, all should be ready. Start gromacs!
    logger.debug(`[INSANE] Creating the CONECT-ed PDB with GROMACS.`);
    let pdbWater, pdbNoWater;
    const to_use_top = prepared_top_wo_elastic
      ? prepared_top_wo_elastic
      : prepared_top;
    const formattedItps = await this.collectItps(
      molecule_itps ? molecule_itps : [],
      itps_without_elastic,
      force_field,
      upper_leaflet,
      lipids,
    );

    try {
      logger.debug(
        `[INSANE] about to call Martinizer.createPdbWithConect with:\n\t### itps ###\n${inspect(formattedItps)}\n\t### toptologies ###\n${inspect(to_use_top)}\n`,
      );
      const { pdb, pdb_no_water } = await Martinizer.createPdbWithConect(
        gro_results_stream,
        to_use_top,
        true,
        force_field,
        formattedItps,
      );
      //pdbs.water    = await readableToString(pdb);
      pdbWater = pdb;
      if (pdb_no_water) pdbNoWater = pdb_no_water; //await readableToString(pdb_no_water);

      //logger.info(`[INSANE] PDB water:${pdbs.water} no_water_pdb:${pdbs.no_water}`);
    } catch (e: any) {
      logger.error(`[INSANE] Following Martinizer error occured:\n${e}`);
      throw new InsaneError("gromacs_crash", e.stack);
    }

    //Write top file to final directory
    //  const final_top_path = workdir + "/full.top"
    /*  try {
      fs.writeFileSync(final_top_path, prepared_top)
    } catch(e) {
      throw new Error("Can't write top file")
    }
    */

    logger.info(`[INSANE] Run seems to be ok :)`);

    return {
      itps: this.flattenItps(formattedItps),
      pdbWater,
      pdbNoWater,
      top: stringToStream(to_use_top), //prepared_top,
    };
  }

  flattenItps(itps: ClientInputAPI): string[] {
    const flatten_path: string[] = [];
    (itps as (string | { [n: string]: string })[]).forEach(
      (v: string | { [n: string]: string }) => {
        if (typeof v === "string") flatten_path.push(v);
        else
          //logger.debug("==>" + inspect(v));
          for (let k in v) flatten_path.push(v[k]);
      },
    );
    return flatten_path;
  }

  async collectItps(
    molecule_itps: string[],
    itps_without_elastic: string[],
    force_field: string,
    upper_leaflet: LipidMap,
    lipids?: LipidMap,
  ) {
    const formattedItps: ClientInputAPI = [
      ...molecule_itps,
      ...itps_without_elastic,
    ];

    if (lipids) {
      logger.debug(`[INSANE]LIPIDS:\n${lipids}`);
      const lipids_itps = await this.getLipidsItps(
        force_field,
        lipids,
        upper_leaflet,
      );

      logger.info(
        `[INSANE] Merging itps\n\t### base ones:\n${inspect(formattedItps)}\n\t### lipid ones:\n${inspect(lipids_itps)}`,
      );
      return [...formattedItps, lipids_itps];
    }
    return formattedItps;
  }

  async prepareRunWithDatabaseMolecule(id: string) {
    const molecule = await Database.molecule.get(id);

    // Extract ZIP file in a temporary directory
    const tmp_dir = await TmpDirHelper.get();

    const { pdb, top, itps } = await MoleculeOrganizer.extract(
      molecule.files,
      tmp_dir,
    );

    return {
      force_field: molecule.force_field,
      top,
      pdb,
      itps,
    };
  }

  protected getUniqueLipids(lower: SimpleLipidMap, upper: SimpleLipidMap) {
    const lipids = new Set<string>();

    for (const e of [...lower, ...upper]) {
      lipids.add(e[0]);
    }

    return [...lipids];
  }

  protected async writePreparedTopFile(
    filename: string,
    insane: TopFile,
    protein: TopFile,
  ) {
    const stream = fs.createWriteStream(filename);

    try {
      const headlines = protein.headlines;
      const system = protein.getField("system");
      const molecules_prot = protein.getField("molecules");
      const molecules_insane = insane.getField("molecules");

      stream.write(headlines.join("\n") + "\n\n");

      stream.write("[system]\n");
      stream.write(system.join("\n") + "\n\n");

      stream.write("[molecules]\n");
      stream.write(molecules_prot.join("\n") + "\n");
      // Insert everything except the protein one
      stream.write(
        molecules_insane
          .filter((e) => !e.startsWith("Protein ") && !e.startsWith(";"))
          .join("\n") + "\n",
      );
    } finally {
      stream.close();
    }

    return filename;
  }

  protected async getPreparedTopFile(insane: TopFile, protein: TopFile) {
    const headlines = protein.headlines;
    const system = protein.getField("system");
    const molecules_prot = protein.getField("molecules");
    const molecules_insane = insane.getField("molecules");

    const top_file = `${headlines.join("\n")}\n\n[system]\n${system.join("\n")}\n\n[molecules]\n${molecules_prot.join("\n")}\n${molecules_insane.filter((e) => !e.startsWith("Protein ") && !e.startsWith(";")).join("\n")}\n`;

    return top_file;
  }

  protected async createLipidItpFiles(workdir: string, lipids: Lipid[]) {
    for (const lipid of lipids) {
      await FsPromise.writeFile(workdir + "/" + lipid.name + ".itp", lipid.itp);
    }
  }
  protected async getLipidsItps(
    force_field: string,
    lipids: LipidMap,
    lipids2: LipidMap,
  ): Promise<{ [name: string]: string }> {
    // Always get the last version of lipid, this may break, if it does not exist ?
    /*
    !! TODO_0307 No we need to import latest version or the one with highest version number.
    */
    logger.debug(
      `[MembraneBuilder:getLipdsItps] lipids ${lipids}, lipids2 ${lipids2} force_field ${force_field}`,
    );

    const itps_obj: { [name: string]: string } = {};
    // Extract ZIP file in a temporary directory
    const tmp_dir = await TmpDirHelper.get();

    for (const lipid of new Set([...lipids, ...lipids2])) {
      const { files } = await DatabaseMoleculeDesk.findOne({
        alias: lipid[0],
        force_field: force_field,
        version: "1.0",
      });
      const { itps } = await MoleculeOrganizer.extract(files, tmp_dir);
      itps_obj[`${lipid[0]}.itp`] = itps[0];
    }
    logger.debug(`[MembraneBuilder:getLipdsItps] itps_obj: ${itps_obj}`);
    return itps_obj;
  }
}

export class InsaneError extends Error {
  constructor(
    public message: "insane_crash" | "gromacs_crash" | "top_file_crash",
    //public workdir: string,
    public trace: string,
  ) {
    super(message);
  }
}

export default MembraneBuilder;
