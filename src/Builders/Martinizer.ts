import { ContactMapMaker } from "./ContactMapMaker";
import TopologyMaker from "../TopologyMaker";
import fs, { promises as FsPromise } from "fs";
import path from "path";

import ForceFieldStore, {
  AvailableForceField,
  BASE_DEFAULT_FORCEFIELD,
} from "../Stores/ForceFieldStore";
import Errors, { ErrorType, JobFSError } from "../Errors";
import {
  InputTextWrapper,
  readableToFile,
  readableToString,
  stringToStream,
} from "../helpers/inputs";
import {
  anyCoorAsTypeAndStream,
  grepOnlyNonMatchingNameWarn,
} from "../helpers/gmxUtils";
import logger from "../logger";

import { TopFile, ItpFile } from "itp_mad_parser";
import JSZip from "jszip";
import Executor from "./Executor";
import { isJobStderrNotEmptyFS } from "./Executor";
import { ArrayValues } from "../helpers/simple";
import { Transform, Readable } from "stream";
import { inspect } from "util";
import { JobOptAPI, ClientInputAPI } from "ms-jobmanager";
//import { AvailableForceFields } from '../helpers/martiniVersions';

/**
 * Tuple of two integers: [{from} atom index, {to} atom index]
 */
export type ElasticOrGoBounds = [number, number];

export interface GoBoundsDetails {
  index_to_real: { [index: number]: number };
  name_to_index: { [name: string]: number };
  index_to_name: { [index: number]: string };
  real_to_index: { [index: number]: number };
  /** Atom count */
  count: number;
}

export type GoMoleculeDetails = { [moleculeType: string]: GoBoundsDetails };

interface CreatePdbConectDetails {
  pdb: Readable;
  gro: Readable;
  pdb_no_water?: Readable;
}

const MARTINIZE_POSITIONS = ["none", "all", "backbone"] as const;
export type MartinizePosition = ArrayValues<typeof MARTINIZE_POSITIONS>;

export interface MartinizeSettings {
  /** PDB file path */
  input: string | Readable; // path or readable

  /** Ignore residues */
  ignore?: string[];

  /** Ignore hydrogens */
  ignh?: boolean;

  /** Force field  */
  ff: AvailableForceField;

  /** Position restrains */
  position: MartinizePosition;

  /** Position restrain force const */
  posref_fc?: number;

  /** Use collagen */
  collagen?: boolean;

  /** Use dihedral */
  dihedral?: boolean;

  /** Elastic bounds */
  elastic?: boolean;
  /** Elastic force const */
  ef?: number;
  /** Elastic lower bound */
  el?: number;
  /** Elastic upper bound */
  eu?: number;
  /** Elastic decay alpha */
  ea?: number;
  /** Elastic decay power */
  ep?: number;
  /** Elastic remover minimum force */
  em?: number;
  /** List of bead names for elastic bound (comma separated in martinize) */
  eb?: string[];

  /** Use govs */
  use_go?: boolean;

  /** Set neutral termini */
  neutral_termini?: boolean;
  /** Apply side chains corrections */
  sc_fix?: boolean;
  /** Cystein bounds */
  cystein_bridge?: string;

  cter?: string;
  nter?: string;
  commandline: string;
  advanced?: boolean;
  builder_mode?: "elastic" | "go" | "classic";
  water_bias?: [number, number, number];
  chain_list?: string[];
  idp_fields?: string;
}

export const Martinizer = new (class Martinizer {
  STEP_MARTINIZE_INIT = "init";
  STEP_MARTINIZE_RUNNING = "internal";
  STEP_MARTINIZE_ENDED_FINE = "martinize-end";
  STEP_MARTINIZE_GET_CONTACTS = "contacts";
  //STEP_MARTINIZE_GO_SITES = 'go-sites';
  STEP_MARTINIZE_GROMACS = "gromacs";

  protected MAX_JOB_EXECUTION_TIME = 5 * 60 * 1000;

  static stringifyTerminiFlag(flag: string, modification: string) {
    if (modification === "capped")
      return flag === "cter" ? "CCAP-ter" : "NCAP-ter";
    if (modification === "neutral")
      return flag === "cter" ? "COOH-ter" : "NH2-ter";

    return flag === "cter" ? "C-ter" : "N-ter";
  }
  isMartinizePosition(value: any): value is MartinizePosition {
    return MARTINIZE_POSITIONS.includes(value);
  }

  /*
  Adapting this to martinize with vermouth 0.10.0

  usage: martinize2 [-h] [-V] [-f INPATH] [-x OUTPATH] [-o TOP_PATH] [-sep]
                  [-merge MERGE_CHAINS] [-resid RESID_HANDLING]
                  [-ignore IGNORE_RES [IGNORE_RES ...]] [-ignh]
                  [-model MODELIDX] [-bonds-from {name,distance,none,both}]
                  [-bonds-fudge BONDS_FUDGE] [-ff TO_FF] [-from FROM_FF]
                  [-ff-dir EXTRA_FF_DIR] [-map-dir EXTRA_MAP_DIR] [-list-ff]
                  [-list-blocks] [-p {none,all,backbone}] [-pf POSRES_FC]
                  [-dssp [DSSP] | -ss SEQUENCE | -collagen] [-ed] [-elastic]
                  [-ef RB_FORCE_CONSTANT] [-el RB_LOWER_BOUND]
                  [-eu RB_UPPER_BOUND] [-ermd RES_MIN_DIST]
                  [-ea RB_DECAY_FACTOR] [-ep RB_DECAY_POWER]
                  [-em RB_MINIMUM_FORCE] [-eb RB_SELECTION] [-eunit RB_UNIT]
                  [-go GO] [-go-eps GO_EPS] [-go-moltype GOVS_MOLTYPE]
                  [-go-low GO_LOW] [-go-up GO_UP] [-go-res-dist GO_RES_DIST]
                  [-water-bias]
                  [-water-bias-eps WATER_BIAS_EPS [WATER_BIAS_EPS ...]]
                  [-id-regions WATER_IDRS [WATER_IDRS ...]] [-scfix]
                  [-cys CYSTEIN_BRIDGE] [-mutate MUTATIONS]
                  [-modify MODIFICATIONS] [-nter MODIFICATIONS]
                  [-cter MODIFICATIONS] [-nt] [-write-graph WRITE_GRAPH]
                  [-write-repair WRITE_REPAIR] [-write-canon WRITE_CANON] [-v]
                  [-maxwarn MAXWARN [MAXWARN ...]]

options:
  -h, --help            show this help message and exit
  -V, --version         show program's version number and exit

Input and output files:
  -f INPATH             Input file (PDB|GRO) (default: None)
  -x OUTPATH            Output coarse grained structure (PDB) (default: None)
  -o TOP_PATH           Output topology (TOP) (default: None)
  -sep                  Write separate topologies for identical chains
                        (default: False)
  -merge MERGE_CHAINS   Merge chains: e.g. -merge A,B,C (+) (default: None)
  -resid RESID_HANDLING
                        How to handle resid. Choice of mol or input. mol:
                        resids are numbered from 1 to n for each molecule
                        input: resids are the same as in the input pdb
                        (default: mol)
  -ignore IGNORE_RES [IGNORE_RES ...]
                        Ignore residues with that name: e.g. -ignore HOH,LIG
                        (+) (default: [])
  -ignh                 Ignore all Hydrogen atoms in the input file (default:
                        False)
  -model MODELIDX       Which MODEL to select. Only meaningful for PDB files.
                        (default: None)
  -bonds-from {name,distance,none,both}
                        How to determine connectivity in the input. If 'none',
                        only bonds from the input file (CONECT) will be used.
                        (default: both)
  -bonds-fudge BONDS_FUDGE
                        Factor with which Van der Waals radii should be scaled
                        when determining bonds based on distances. (default:
                        1.2)

Force field selection:
  -ff TO_FF             Which forcefield to use (default: martini3001)
  -from FROM_FF         Force field of the original structure. (default:
                        charmm)
  -ff-dir EXTRA_FF_DIR  Additional repository for custom force fields.
                        (default: [])
  -map-dir EXTRA_MAP_DIR
                        Additional repository for mapping files. (default: [])
  -list-ff              List all known force fields, and exit. (default:
                        False)
  -list-blocks          List all Blocks and Modifications known to the force
                        field, and exit. (default: False)

Position restraints:
  -p {none,all,backbone}
                        Output position restraints (none/all/backbone)
                        (default: none)
  -pf POSRES_FC         Position restraints force constant in kJ/mol/nm^2
                        (default: 1000)

Secondary structure handling:
  -dssp [DSSP]          DSSP executable for determining structure. If this
                        flag is givenbut no executable is specified, the
                        mdtraj library will be usedto compute the secondary
                        structure, if it can be imported. (default: None)
  -ss SEQUENCE          Manually set the secondary structure of the proteins.
                        (default: None)
  -collagen             Use collagen parameters (default: False)
  -ed                   Use dihedrals for extended regions rather than elastic
                        bonds (default: False)

Protein elastic network:
  -elastic              Write elastic bonds (default: False)
  -ef RB_FORCE_CONSTANT
                        Elastic bond force constant Fc in kJ/mol/nm^2
                        (default: 500)
  -el RB_LOWER_BOUND    Elastic bond lower cutoff: F = Fc if rij < lo
                        (default: 0)
  -eu RB_UPPER_BOUND    Elastic bond upper cutoff: F = 0 if rij > up (default:
                        0.9)
  -ermd RES_MIN_DIST    The minimum separation between two residues to have an
                        RB the default value is set by the force-field.
                        (default: None)
  -ea RB_DECAY_FACTOR   Elastic bond decay factor a (default: 0)
  -ep RB_DECAY_POWER    Elastic bond decay power p (default: 1)
  -em RB_MINIMUM_FORCE  Remove elastic bonds with force constant lower than
                        this (default: 0)
  -eb RB_SELECTION      Comma separated list of bead names for elastic bonds
                        (default: None)
  -eunit RB_UNIT        Establish what is the structural unit for the elastic
                        network. Bonds are only created within a unit. Options
                        are molecule, chain, all, or aspecified region defined
                        by resids, with followingformat:
                        <start_resid_1>:<end_resid_1>,
                        <start_resid_2>:<end_resid_2>... (default: molecule)

Virtual site based GoMartini:
  -go GO                Contact map to be used for the Martini Go
                        model.Currently, only one format is supported. See
                        docs. (default: None)
  -go-eps GO_EPS        The strength of the Go model structural bias in
                        kJ/mol. (default: 9.414)
  -go-moltype GOVS_MOLTYPE
                        Set the name of the molecule when using Virtual Sites
                        GoMartini. (default: molecule_0)
  -go-low GO_LOW        Minimum distance (nm) below which contacts are
                        removed. (default: 0.3)
  -go-up GO_UP          Maximum distance (nm) above which contacts are
                        removed. (default: 1.1)
  -go-res-dist GO_RES_DIST
                        Minimum graph distance (similar sequence distance)
                        below whichcontacts are removed. (default: 3)

Apply water bias.:
  -water-bias           Automatically apply water bias to different secondary
                        structure elements. (default: False)
  -water-bias-eps WATER_BIAS_EPS [WATER_BIAS_EPS ...]
                        Define the strength of the water bias by secondary
                        structure type. For example, use `H:3.6 C:2.1` to bias
                        helixes and coils. Using the idr option (e.g. idr:2.1)
                        intrinsically disordered regions are biased
                        seperately. (default: [])
  -id-regions WATER_IDRS [WATER_IDRS ...]
                        Intrinsically disordered regions specified by
                        resid.These parts are biased differently when applying
                        a water bias.format: <start_resid_1>:<end_resid_1>
                        <start_resid_2>:<end_resid_2>... (default: [])

Protein description:
  -scfix                Apply side chain corrections. (default: False)
  -cys CYSTEIN_BRIDGE   Cystein bonds (default: none)
  -mutate MUTATIONS     Mutate a residue. Desired mutation is specified as,
                        e.g. A-PHE45:ALA. The format is
                        <chain>-<resname><resid>:<new resname>. Elements of
                        the specification can be omitted as required.
                        (default: [])
  -modify MODIFICATIONS
                        Add a modification to a residue. Desired modification
                        is specified as, e.g. A-ASP45:ASP0. The format is
                        <chain>-<resname><resid>:<modification>. Elements of
                        the specification can be omitted as required.
                        (default: [])
  -nter MODIFICATIONS   Shorthand for patching N-termini. An N-terminus is
                        defined as a residue which is connected to 1 other
                        residue, and has the highest resid. (default: [])
  -cter MODIFICATIONS   Shorthand for patching C-termini. A C-terminus is
                        defined as a residue which is connected to 1 other
                        residue, and has the lowest resid. (default: [])
  -nt                   Set neutral termini (charged is default). Alias for
                        "-nter NH2-ter -cter COOH-ter" (default: False)

Debugging options:
  -write-graph WRITE_GRAPH
                        Write the graph as PDB after the MakeBonds step.
                        (default: None)
  -write-repair WRITE_REPAIR
                        Write the graph as PDB after the RepairGraph step. The
                        resulting file may contain "nan" coordinates making it
                        unreadable by most softwares. (default: None)
  -write-canon WRITE_CANON
                        Write the graph as PDB after the
                        CanonicalizeModifications step. The resulting file may
                        contain "nan" coordinates making it unreadable by most
                        software. (default: None)
  -v                    Enable debug logging output. Can be given multiple
                        times. (default: 0)
  -maxwarn MAXWARN [MAXWARN ...]
                        The maximum number of allowed warnings. If more
                        warnings are encountered no output files are written.
                        (default: [])
  */
  settingsToCommandline(settings: Partial<MartinizeSettings>) {
    const full: MartinizeSettings = Object.assign(
      {},
      {
        input: "",
        ff: "martini22",
        position: "none",
        commandline: "",
      },
      settings,
    );
    // Use gmx default dssp engine
    let command_line =
      " -dssp -x output.pdb -o system.top -ff " +
      full.ff +
      " -p " +
      full.position;

    logger.debug(`[Martinizer] ${inspect(full)}`);
    if (full.ignore) {
      command_line += " " + full.ignore.join(",");
    }
    if (full.ignh) {
      command_line += " -ignh";
    }
    if (full.posref_fc) {
      command_line += " -pf " + full.posref_fc.toString();
    }
    if (full.collagen) {
      command_line += " -collagen ";
    }
    if (full.dihedral) {
      command_line += " -ed ";
    }
    if (full.elastic) {
      command_line += " -elastic ";
      if (full.chain_list)
        command_line += ` -merge ${full.chain_list.join(",")}`;
    }
    if (full.ef) {
      command_line += " -ef " + full.ef.toString();
    }
    if (full.el) {
      command_line += " -el " + full.el.toString();
    }
    if (full.eu) {
      command_line += " -eu " + full.eu.toString();
    }
    if (full.ea) {
      command_line += " -ea " + full.ea.toString();
    }
    if (full.ep) {
      command_line += " -ep " + full.ep.toString();
    }
    if (full.em) {
      command_line += " -em " + full.em.toString();
    }
    if (full.eb) {
      command_line += " -eb " + full.eb.toString();
    }
    /*if (full.use_go) {
      command_line += " -govs-include "; // V0.10 obsolete
    }*/
    /*
    V0.10 new flags
    -govs
    NOT SEEN instead -go
    */

    if (full.neutral_termini) {
      command_line += " -nt ";
    }
    if (full.sc_fix) {
      command_line += " -scfix ";
    }
    if (full.cystein_bridge) {
      command_line += " -cys " + full.cystein_bridge;
    }
    if (full.cter)
      command_line += ` -cter ${Martinizer.stringifyTerminiFlag("cter", full.cter)}`;
    if (full.nter)
      command_line += ` -nter ${Martinizer.stringifyTerminiFlag("nter", full.nter)}`;

    if (full.water_bias) {
      const sym = ["E", "C", "H"];
      const water_bias_flag = full.water_bias
        .map((v, i) => (v != 0 ? `${sym[i]}:${v} ` : ""))
        .filter((v) => v !== "")
        .join(" ");

      command_line +=
        water_bias_flag == ""
          ? ""
          : ` -water-bias -water-bias-eps ${water_bias_flag}`; // Handle the [0, 0, 0] case
    }

    if (full.idp_fields) command_line += ` -id-regions ${full.idp_fields}`;

    logger.debug(
      `[Martinizer.settingsToCommadLine] build cl : ${command_line}`,
    );

    return { command_line: command_line, full: full };
  }

  /**
   * Create a martinize run.
   * Returns created path to created PDB, TOP and ITP files.
   */
  async run(
    settings: Partial<MartinizeSettings>,
    resultsPath: string,
    onStep?: (step: string, ...data: any[]) => void,
  ) {
    const MARTINIZE_WARN = "martinize_warnings.log";
    const OUTPUT_PDB = "output.pdb";
    const OUTPUT_GRO = "output.gro";
    const OUTPUT_TOP = "system.top";

    logger.debug(`[Martinizer:run] raw settings values ${inspect(settings)}`);
    const command_line = this.settingsToCommandline(settings);
    let map_filename = undefined;

    if (settings.use_go) {
      logger.debug("[Martinizer:run] Using GO model, computing rcsu map");
      try {
        // Get input from workfolder // input.pdb
        map_filename = await ContactMapMaker.getCcMapRCSU(
          settings.input as string,
          resultsPath,
        );
        command_line.command_line += ` -go ./input/map_rcsu.txt`;
      } catch (e: any) {
        logger.error("[Martinizer] ContactMapMaker.getCcMapRCSU failes");
        return Errors.throw(ErrorType.ContactMapFailed, { error: e.message });
      }
      logger.debug("[Martinizer] ContactMapMaker.getCcMapRCSU successfull");
    }

    logger.debug(`[MARTINIZER:run] cmd:  \"${command_line.command_line}\"`);
    // Step: Martinize Init
    onStep?.(this.STEP_MARTINIZE_INIT);

    let jobOpt: JobOptAPI = {
      exportVar: {
        MARTINIZE_WARN,
        COMMAND_LINE: command_line.command_line,
      },
      inputs: !settings.use_go
        ? ({
            "input.pdb": settings.input,
          } as ClientInputAPI)
        : ({
            "input.pdb": settings.input,
            "map_rcsu.txt": map_filename,
          } as ClientInputAPI),
    };

    const pdb_path = `${resultsPath}/${OUTPUT_PDB}`; //path of final pdb result file
    const gro_path = `${resultsPath}/${OUTPUT_GRO}`; //path of final gro result file
    const warn_path = `${resultsPath}/${MARTINIZE_WARN}`;

    let itp_files_copied: string[]; //path of itp files copied to final directory
    let jobId: string; //martinize job id

    let itpContents: { [name: string]: Readable } = {};
    let itpContentsStr: { [name: string]: string } = {};
    let topStream: Readable;
    let itp_files: string[];
    let pdbStream: Readable;
    let pdbStreamGo: Readable;

    let inputStream: Readable | undefined = undefined;
    try {
      const { stdout, jobFS } = await Executor.run(
        // Native error should trigger a Error object w/ a JobFS field, if not ms-jobmanager should be patched, an issue has been open b/t it
        "martinize",
        jobOpt,
      );
      logger.debug(
        `[MARTINIZER:run] JobFS is ${jobFS != undefined ? "define" : "undefine"}`,
      );
      inputStream = await jobFS.readToStream("input/input.pdb");
      pdbStream = await jobFS.readToStream("output.pdb");
      await jobFS.copy(OUTPUT_PDB, pdb_path);
      // Trying to convert output.pdb to output.gro
      const pdb2groRes = await Executor.run("pdb2gro", {
        inputs: { "molecule.pdb": pdb_path },
      });
      await pdb2groRes.jobFS.copy("molecule.gro", gro_path);

      pdbStreamGo = await jobFS.readToStream("output.pdb");
      topStream = await jobFS.readToStream(OUTPUT_TOP);
      itp_files = await jobFS.list("*.itp");

      if (itp_files.length === 0)
        throw new JobFSError("Itps not found after martinize", jobFS);
      logger.debug(`[MARTINIZER:run] ${itp_files.length} itp files found`);
      if (!pdbStream.readable)
        throw new JobFSError("Pdb file is empty after martinize", jobFS);
      logger.debug(`[MARTINIZER:run] PDB output stream seems valid`);
      if (!topStream.readable)
        throw new JobFSError("Top file is empty after martinize", jobFS);
      logger.debug(`[MARTINIZER:run] TOP output stream seems valid`);

      logger.debug(
        `[MARTINIZER:run] Attempting to copy ITP files into \"${resultsPath}\"`,
      );
      for (const itpName of itp_files) {
        const final_itp_path = `${resultsPath}/${itpName}`;
        itpContents[itpName] = await jobFS.readToStream(itpName);
        itpContentsStr[itpName] = await jobFS.readToString(itpName);
        await jobFS.copy(itpName, final_itp_path);
      }
      itp_files_copied = itp_files.map(
        (itpName) => `${resultsPath}/${itpName}`,
      );
      logger.debug(
        `[MARTINIZER:run] Attempting to copy WARN files into \"${warn_path}\"`,
      );
      await jobFS.copy(MARTINIZE_WARN, warn_path);

      jobId = jobFS.job.id;
    } catch (e: any) {
      logger.error(`[MARTINIZE:run]error: ${e}`);
      const jobFS = e.jobFS;
      const zipArchiveStream = await jobFS.zap();
      return Errors.throw(ErrorType.MartinizeRunFailed, {
        error: e.message,
        stdout: jobFS.stdout,
        stderr: jobFS.stderr,
        dir: zipArchiveStream,
      });
    }

    logger.debug(
      `[MARTINIZER:run] Intial stage of PDB/TOP/ITP generation is successful.`,
    );
    logger.debug(`[MARTINIZER:run] Martinize out ITPs:\n${itp_files}`);
    const _ = await readableToString(topStream);
    topStream = stringToStream(_);
    logger.debug(`[MARTINIZER:run] Martinize TOP content:\n${_}`);

    onStep?.(this.STEP_MARTINIZE_ENDED_FINE);

    // This is post processing of go-virt, it should go away
    logger.debug(
      "[MARTINIZER:run] Creating full TOP file for Martinize built molecule.",
    );

    let beforeElasticTop: string;
    try {
      const top: Readable = await TopologyMaker.createTopFile({
        consumer: "martinize",
        srcTopology: topStream,
        forcefield: settings.ff!,
        itpsPath: itp_files,
        linkTargetDir: resultsPath,
        excludedDefine: ["#define GO_VIRT"],
      });
      beforeElasticTop = await readableToString(top);
    } catch {
      throw new Error("[MARTINIZER:run] Error, can't create top file");
    }

    // "elastic" | "elnedyn" processing block    START
    logger.debug(
      `[MARTINIZER:run] beforeElastic top content:\n${beforeElasticTop}`,
    );
    let elasticBounds: ElasticOrGoBounds[] | undefined = undefined;
    let elasticTop: string | undefined = undefined;
    if (
      settings.builder_mode === "elastic" ||
      settings.ff?.includes("elnedyn")
    ) {
      logger.debug("[MARTINIZER:run] Compute elastic network");
      try {
        const { elastic_bounds, elastic_itps, itp_without_elastic } =
          await this.computeElasticNetworkBounds(
            beforeElasticTop,
            Object.values(itpContentsStr),
            resultsPath,
          );
        for (const itpName of Object.keys(elastic_itps)) {
          const where = `${resultsPath}/${itpName}`;
          fs.writeFileSync(where, elastic_itps[itpName]);
          itp_files_copied.push(where);
        }
        itpContents = { ...itpContents, ...itp_without_elastic };
        elasticBounds = elastic_bounds;
        //Create top file without elastic bounds to create pdb without elastic in CONECT fields
        logger.debug(
          "[MARTINIZER:run] Creating top file without elastic links",
        );
        const noElasticTop = await TopologyMaker.createTopFile({
          consumer: "martinize",
          excludedItpsExtraByRegExp: ["molecule_[0-9]+\.itp"],
          srcTopology: stringToStream(beforeElasticTop),
          forcefield: settings.ff ?? "martini22",
          itpsPath: Object.keys(itp_without_elastic),
        });
        elasticTop = await readableToString(noElasticTop);
        logger.debug(
          `[MARTINIZER:run] computed top without elastic content:\n${elasticTop}`,
        );
      } catch (e) {
        logger.error(e);
        return Errors.throw(ErrorType.ElasticNetworkFailed, {
          error: "Can't compute elastic network bounds",
        });
      }
    } // "elastic" | "elnedyn" processing block    END

    if (settings.use_go) {
      // Go early exit devel version
      logger.debug(
        `[MARTINIZER:run] Hacking swaping should occur here ${resultsPath}`,
      );
      // stringToFile beforeElasticTop into
      const goTopFilePath = `${resultsPath}/go_final.top`;
      const s = stringToStream(beforeElasticTop);
      await readableToFile(s, goTopFilePath);

      const pdbFileResultPath = `${resultsPath}/output.pdb`;
      await readableToFile(pdbStreamGo, pdbFileResultPath);

      return {
        pdb: pdbFileResultPath,
        itps: [itp_files_copied],
        top: goTopFilePath,
        warns: warn_path,
        jobId,
        final_gro: gro_path,
        //dir: dir,
        //elastic_bonds: elasticBounds,
      };
    } // early exit

    logger.debug(
      `[MARTINIZER:run] Elastic/elnedyn/classic:\n\tbeforeElastic:\n${beforeElasticTop}\n\telasticTop:\n${elasticTop}`,
    );

    logger.debug(
      "[MARTINIZER-RUN] Creating PDB with CONECT entries for Martinize built molecule.",
    );
    onStep?.(this.STEP_MARTINIZE_GROMACS);
    let pdb_with_conect;
    let final_gro;
    const finalTop = elasticTop ? elasticTop : beforeElasticTop;

    logger.debug(`[MARTINIZER-RUN] finalTop: ${finalTop}`);
    logger.debug(`[MARTINIZER-RUN] itp keys ${Object.keys(itpContents)}`);
    try {
      //PROVIDE ELASTIC TOP IF ELASTIC IS DONE
      const { pdb, gro } = await this.createPdbWithConect(
        pdbStream,
        finalTop,
        false,
        settings.ff,
        itpContents,
      );
      pdb_with_conect = pdb;
      final_gro = gro;
    } catch {
      throw new Error(
        "[MARTINIZER:run] Elastic network createPdbWithConect failed",
      );
    }

    let sortedItps: string[][];
    let final_top_path: string;
    try {
      sortedItps =
        settings.builder_mode === "elastic" || settings.ff?.includes("elnedyn")
          ? await this.sortItpsFromTop(finalTop, itp_files_copied)
          : [itp_files_copied];
      final_top_path = `${resultsPath}/full.top`;
      fs.writeFileSync(final_top_path, finalTop);
    } catch (e) {
      throw new Error(
        "[MARTINIZER:run] Error while sort final itps and/or writing final top",
      );
    }

    const path_pdb_with_conect = `${resultsPath}/martinize_output_w_conect.pdb`;
    const path_final_gro = `${resultsPath}/martinize_output.gro`;
    await readableToFile(pdb_with_conect, path_pdb_with_conect);
    await readableToFile(final_gro, path_final_gro);
    logger.debug(
      "[MARTINIZER:run] Run is complete, everything seems to be fine :)",
    );

    return {
      pdb: path_pdb_with_conect,
      itps: sortedItps,
      top: final_top_path,
      warns: warn_path,
      final_gro: path_final_gro,
      jobId,
      //dir: dir,
      elastic_bonds: elasticBounds,
    };
  }

  async sortItpsFromTop(topFile_content: string, itp_files: string[]) {
    const sortedItps: string[][] = [];
    const system = TopFile.readFromString(topFile_content);
    for (const mol of system.molecules) {
      const name = mol.type;
      const itps = itp_files.filter((itp_filename) =>
        itp_filename.includes(name),
      );
      sortedItps.push(itps);
    }
    return sortedItps;
  }
  /**
   * Modify the original top file in order to include the right ITPs,
   * and create a link of the force field martini file into current directory.
   *
   * ITPs in {itps_path} MUST be in {current_directory} !
   *
   * Returns new TOP filename and all the used ITPs to generate top.
   */

  /**
   * Create the conect entries of the desired PDB/GRO.
   *
   * This function should be done ONCE: After a Martinize Run / A INSANE Run / A molecule insert in database
   *
   * Don't do it at each call!
   *
   * Need the TOP topology file.
   * ITP can be provided as path to file or Record ot string to path/Readable
   */
  async createPdbWithConect(
    pdb_or_gro: string | Readable,
    top_content: string,
    remove_water: boolean = false,
    force_field: AvailableForceField = BASE_DEFAULT_FORCEFIELD,
    itps?: ClientInputAPI,
    lipids?: any,
    ignoreWarnings?: boolean,
  ): Promise<CreatePdbConectDetails> {
    logger.debug(`[Martinizer:createPdbWithConect] Running...\n`);
    const [groOrPdb, inputStream] = await anyCoorAsTypeAndStream(pdb_or_gro);
    logger.debug(
      `\n\tpdb_or_gro:${groOrPdb}\n\ttop_content:\n${top_content}\n\tremove_water:${remove_water}\n\tforcefields:${force_field}\n\titps:\n${inspect(itps)}`,
    );
    const ffStore = ForceFieldStore.getStore();
    const force_fields = ffStore.getCompleteFilesForForceField(force_field);
    logger.debug(
      `[Martinizer:createPdbWithConect] joined forcefield files :\n${force_fields}`,
    );
    const inputCoorFileName = `input.${groOrPdb}`;

    const jobInput: JobOptAPI = {
      exportVar: {
        DEL_WATER_BOOL: remove_water ? "YES" : "NO",
        INPUT_NAME: inputCoorFileName,
        INPUT_TYPE: groOrPdb,
        output_conect: "output-conect.pdb",
        output_conect_no_water: "output-conect-no-w.pdb",
        output_no_water: "output-no-w.pdb",
        output: "output.pdb",
        IGNORE_WARNINGS: ignoreWarnings ? "YES" : "NO",
      },
      inputs: [
        {
          [inputCoorFileName]: inputStream,
          "input.top": stringToStream(top_content),
          "run.mdp": ffStore.getProductionFile("run.mdp"),
        },
        ...force_fields,
      ],
    };
    logger.debug(
      `[MARTINIZER:createPdbWithConect ] 'connect' JobInput : ${inspect(jobInput)}`,
    );
    if (itps) {
      logger.debug(
        `[MARTINIZER:createPdbWithConect] adding following itps:\n${inspect(itps)}`,
      );
      if (Array.isArray(itps))
        //@ts-ignore
        itps.forEach((itp) => jobInput.inputs.push(itp));
      else
        //@ts-ignore
        jobInput.inputs.push(itps);
    }
    try {
      logger.debug(`[MARTINIZER:createPdbWithConect ] Running...`);
      const { stdout, jobFS } = await Executor.run("conect", jobInput);
      logger.debug(`[MARTINIZER:createPdbWithConect ] jobFS.list()`);
      logger.debug(await jobFS.list());
      // RESUME HERE
      logger.debug(`[MARTINIZER:createPdbWithConect ] Terminated...`);
      //const pdb_stream = await jobFS.readToStream("output-conect.pdb")
      //const top_stream = await jobFS.readToStream('input/input.top')
      //groOrPdb
      const gro = await jobFS.readToStream("final_output.gro");
      const pdb = await jobFS.readToStream("output-conect.pdb");

      //const topFile = "input.top";
      //const top_out = await jobFS.list('input.top')
      //const gro_out = await jobFS.list('final_output.gro')

      if (!pdb.readable) {
        throw new Error(
          `PDB could not be created for an unknown reason (or more than 1 output exists)`,
        );
      }

      if (!gro.readable) {
        throw new Error(
          `Top could not be copied for an unknown reason (or more than 1 top exists)`,
        );
      }
      const res: CreatePdbConectDetails = { gro, pdb };
      if (remove_water)
        res.pdb_no_water = await jobFS.readToStream("output-conect-no-w.pdb");

      return res;
    } catch (e) {
      if (isJobStderrNotEmptyFS(e)) {
        if (ignoreWarnings) {
          logger.error(
            `[MARTINIZER:createPdbWithConect ] stderr persist, giving up:\n${e}`,
          );
          throw new Error(`Error while conect pdb job`);
        }
        if (
          await grepOnlyNonMatchingNameWarn(
            await e.jobFS.readToStream("2.grompp.stderr"),
          )
        ) {
          logger.debug(
            `[MARTINIZER:createPdbWithConect ] caught harmless warning errors resubmitting w/ --maxwarn...`,
          );
          // return itself w/ warnflags on
          return this.createPdbWithConect(
            pdb_or_gro,
            top_content,
            remove_water,
            force_field,
            itps,
            lipids,
            true,
          );
        }
        logger.error(
          `[MARTINIZER:createPdbWithConect] stderr '${e.stderr}' from following Job\n${e.job.pprint()}`,
        );
      } else {
        logger.error(
          `[Martinizer:createPdbWithConect] Error ${e?.constructor.name}`,
        );
        logger.error(inspect(e));
      }
      throw new Error(`Error while conect pdb job`);
    }
  }
  /**
   * Create the conect entries of the desired PDB/GRO.
   *
   * This function should be done ONCE: After a Martinize Run / A INSANE Run / A molecule insert in database
   *
   * Don't do it at each call!
   *
   * Need the TOP topology file.
   * ITP includes should be able to be resolved, use the {base_directory} parameter
   * in order to set the used current directory path.
   */
  async createPdbWithConectWithoutWater(
    pdb_or_gro_filename: string,
    top_filename: string,
    base_directory: string,
    lipids?: any,
    warnFlags?: boolean,
  ) {
    const pdb_water = await this.createPdbWithConect(
      pdb_or_gro_filename,
      top_filename,
      true,
      lipids,
    );

    const pdb_no_w = base_directory + "/output-conect-no-w.pdb";
    const exists = await FsPromise.access(pdb_no_w, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);

    if (!exists) {
      throw new Error(
        "PDB could not be created for an unknown reason. Check the files gromacs.stdout and gromacs.stderr in directory " +
          base_directory +
          ".",
      );
    }

    return {
      water: pdb_water,
      no_water: pdb_no_w,
    };
  }

  /**
   * Generate an object than contain "additionnal" bounds between atoms,
   * that are created with the elastic network (option -elastic).
   *
   * Specificy only ITP files that are generated by Martinize, not the force field itself!!
   *
   * TODO: worker thread
   */
  async computeElasticNetworkBounds(
    top_file: string,
    itp_files: string[],
    workdir: string,
  ) {
    //top_file and itp_files : content as string
    logger.verbose("[ELASTIC-BUILD] Extracting elastic network bonds.");

    const bounds: ElasticOrGoBounds[] = [];

    logger.debug("[ELASTIC-BUILD] Reading TOP+ITP files.");
    const top = TopFile.readFromString(top_file, itp_files);

    logger.debug(
      `[ELASTIC-BUILD] Available molecules: ${top.molecules
        .map(
          (molecule) =>
            `${molecule.type} (${molecule.count} time${molecule.count > 1 ? "s" : ""})`,
        )
        .join(", ")}`,
    );

    // Incrementer for designating PDB line
    let i = 0;
    let elasticItps: { [name: string]: string } = {};
    let withoutElasticItps: { [name: string]: Readable } = {};

    const readMolecule = new Set();

    for (const molecule of top.molecules) {
      if (readMolecule.has(molecule.type)) {
        logger.debug(
          "[ELASTIC-BUILD] Skiping already read molecule " +
            molecule.type +
            ".",
        );
        continue;
      }
      readMolecule.add(molecule.type);
      logger.debug("[ELASTIC-BUILD] Reading molecule " + molecule.type + ".");

      // Get the number of atoms in a single chain of this molecule
      const itp = molecule.itp;
      const atom_count = itp.atoms.filter(
        (line) => line && !line.startsWith(";"),
      ).length;

      //const name = molecule.name;
      //Write elastic bonds in an other itp file to avoid elastic bonds representation with ngl.
      // Output connect will be computed without this new file, and then it will be included again.
      const elastic_bonds = itp.getSubfield("bonds", "Rubber band");
      const elastic_itp_name = molecule.type + "_rubber_band.itp";
      const elastic_itp_path = workdir + "/" + elastic_itp_name;

      const elastic_itp = new ItpFile();
      elastic_itp.appendField("bonds", elastic_bonds);

      fs.writeFileSync(elastic_itp_path, elastic_itp.toString());
      const elastic_itp_string = elastic_itp.toString();
      elasticItps[elastic_itp_name] = elastic_itp_string;
      //elasticItps.push(elastic_itp_stream)

      //Delete elastic bonds from current itp
      const correctedItp =
        workdir + "/" + molecule.type + "_without_elastic.itp";
      logger.debug(
        `[ELASTIC-BUILD] ${molecule.type}_without_elastic.itp content b4 subfield remove:\n${itp.toString()}\n[ELASTIC-BUILD] footer`,
      );
      itp.removeSubfield("bonds", "Rubber band");
      logger.debug(
        `[ELASTIC-BUILD] ${molecule.type}_without_elastic.itp content after subfield remove:\n${itp.toString()}\n[ELASTIC-BUILD] footer`,
      );
      fs.writeFileSync(correctedItp, itp.toString()); //Write itp without rubber bands
      const without_elastic_itp_string = itp.toString();
      withoutElasticItps[molecule.type + "_without_elastic.itp"] =
        stringToStream(without_elastic_itp_string);
      //withoutElasticItps.push(without_elastic_itp_stream)

      logger.debug(
        `[ELASTIC-BUILD] appendInclude ${elastic_itp_name} in ${itp.name}`,
      );
      itp.appendInclude(elastic_itp_name, "bonds");
      fs.writeFileSync(workdir + "/" + molecule.type + ".itp", itp.toString()); //Rewrite initial itp with include statement for rubber bands
      // const initial_itp_stream = itp.asReadStream()

      for (const band of elastic_bonds) {
        if (!band.startsWith(";")) {
          const [atom_from, atom_to] = band.split(/\s+/g);
          bounds.push([Number(atom_from) + i, Number(atom_to) + i]);
        }
      }

      i += atom_count;
    }
    return {
      elastic_bounds: bounds,
      elastic_itps: elasticItps,
      itp_without_elastic: withoutElasticItps,
    };

    /*for (const molecule of top.molecules) {
      logger.debug("[ELASTIC-BUILD] Reading molecule " + molecule.type + ".");

      // Get the number of atoms in a single chain of this molecule
      const itp = molecule.itp;

      const atom_count = itp.atoms.filter(line => line && !line.startsWith(';')).length;
      let chain_n = 0;

      // There is one ITP per chain
      for (let mol_count = 0; mol_count < molecule.count; mol_count++) {
        let should_read = false;
        chain_n++;

        logger.verbose(`[ELASTIC-BUILD] Chain ${chain_n} of molecule "${molecule.type}": ${itp.bonds.length} bond lines.`);

        for (const band of itp.bonds) {
          if (band.startsWith(';')) {
            // Find the elastic related comments
            if (
              // Todo verify if it is elastic bounds
              // band.startsWith('; Long elastic bonds for extended regions') ||
              // band.startsWith('; Short elastic bonds for extended regions') ||
              band.startsWith('; Rubber band')
            ) {
              should_read = true;
            }
            // This is ALWAYS after rubber band/elastic bonds comments, we can stop here
            else if (
              band.startsWith('; Side chain bonds')
            ) {
              break;
            }
            else {
              should_read = false;
            }

            // Its a comment, skip it
            continue;
          }

          if (!should_read || !band) {
            continue;
          }

          // Here is a line with a band bound.
          // The two first numbers are the two concern atom by the bound.
          // Here: Atom 1 and 11 of the PDB file, part {itp_index}.
          // MARTINI22: 1 11 6 0.598 500.0
          // MARTINI30: 1 11 6 0.59901 500.0

          const [atom_from, atom_to, ] = band.split(/\s+/g);

          bounds.push([
            Number(atom_from) + i,
            Number(atom_to) + i,
          ]);
        }

        // Add atom count of this molecule to i
        i += atom_count;
      }
    }*/
  }

  /**
   * Generate an object than contain "additionnal" bounds between atoms, that are created with the Go model (option -govs-include).
   *
   * Specificy only ITP files that are generated by Martinize, not the force field itself!!
   *
   * TODO: worker thread
   */
  async __UNSAFEcomputeGoModelBounds(
    top_file: string,
    itp_files: string[],
    remove_duplicates = true,
  ) {
    /*
     *  Même si il y a deux chaînes, en mode go elles seront dans une seule molécule (normalement).
     *
     *  1: Lire les noms des atoms Go dans [atoms]: {molecule_type}_{i}
     *  2: Lire les associations go_atom => real atom index dans [virtual_sitesn] après comment "; Virtual go site"
     *  3: Lire le fichier {molecule_type}_go-table-VirtGoSites.itp qui définit les liaisons go_atom <=> go_atom
     *  4: Convertir ces liaisons go <=> go en "additionnal" bonds entre real atoms
     */

    logger.verbose("[GO-VIRT-SITES] Reading system topology.");
    const top = await TopFile.read(top_file);
    const molecule_types: string[] = [];

    for (const molecule of top.getField("molecules", true)) {
      // molecule_0    1 (count is always 1 for Go model.)
      const [name] = molecule.split(ItpFile.BLANK_REGEX);
      molecule_types.push(name);
    }

    // Here, we store bounds
    const bounds: ElasticOrGoBounds[] = [];
    const details: GoMoleculeDetails = {};

    // Increment counter for bounds add.
    let i = 0;

    for (const molecule_type of molecule_types) {
      logger.debug(
        `[GO-VIRT-SITES] [${molecule_type}] Finding files used to describe the Go model.`,
      );

      // Find the [molecule_type].itp and [molecule_type]gotable ITP in ITP files
      const molecule_itp_index = itp_files.findIndex(
        (e) => path.basename(e) === molecule_type + ".itp",
      );
      const go_table_index = itp_files.findIndex(
        (e) => path.basename(e) === molecule_type + "_go-table_VirtGoSites.itp",
      );

      if (molecule_itp_index === -1 || go_table_index === -1) {
        logger.error(
          `[GO-VIRT-SITES] [${molecule_type}] Molecule ITP file or Go Virt Table not found.`,
        );
        continue;
      }

      // Instanciate ITP
      const molecule_itp = await ItpFile.read(itp_files[molecule_itp_index]);
      const go_table = await ItpFile.read(itp_files[go_table_index]);

      // Read the molecule file
      logger.debug(`[GO-VIRT-SITES] [${molecule_type}] Reading ITP files.`);

      // Count all atoms, used to increment atom counter at the end of loop
      const all_atom_count = molecule_itp.atoms.filter(
        (line) => line && !line.startsWith(";"),
      ).length;

      const prefix = molecule_type + "_";
      /** Link go atom index to real atom index. */
      const index_to_real: { [index: number]: number } = {};
      /** Link go atom name to go atom index. */
      const name_to_index: { [name: string]: number } = {};

      // WILL BE USEFUL WHEN BOUNDS ARE INSERTED/DELETED DYNAMICALLY
      /** Link go atom index to go atom name. */
      const index_to_name: { [index: number]: string } = {};
      /** Link real atom index to go atom index. */
      const real_to_index: { [index: number]: number } = {};

      details[molecule_type] = {
        index_to_real,
        name_to_index,
        index_to_name,
        real_to_index,
        count: all_atom_count,
      };

      // Step 1: Find atoms that name start by "{molecule_type}_" in category "atoms"
      logger.debug(
        `[GO-VIRT-SITES] [${molecule_type}] Looking for virtual atoms.`,
      );

      for (const atom_line of molecule_itp.atoms) {
        // Typical line is :
        // 2575 molecule_0_9       9 LYS CA  2575    0

        const [index, name] = atom_line.split(ItpFile.BLANK_REGEX);

        if (name.startsWith(prefix)) {
          name_to_index[name] = Number(index);
          index_to_name[Number(index)] = name;
        }
      }

      // Step 2: Associate go atom index => real atom index
      let seen_virt_comment = false;

      logger.debug(
        `[GO-VIRT-SITES] [${molecule_type}] Looking for virtual sites description.`,
      );
      for (const virt_line of molecule_itp.virtual_sites) {
        if (virt_line.startsWith("; Virtual go site")) {
          seen_virt_comment = true;
          continue;
        }

        if (!seen_virt_comment) {
          continue;
        }

        // Typical line is:
        // 2575 1    1
        const [go_index, , real_index] = virt_line.split(ItpFile.BLANK_REGEX);
        index_to_real[Number(go_index)] = Number(real_index);
        real_to_index[Number(real_index)] = Number(go_index);
      }

      const n_atoms = Object.keys(name_to_index).length;
      const n_sites = Object.keys(index_to_real).length;

      if (n_sites !== n_atoms) {
        // Print number of atoms only if useful.
        logger.verbose(
          `[GO-VIRT-SITES] [${molecule_type}] ${n_atoms} virtual atoms found.`,
        );
        logger.verbose(
          `[GO-VIRT-SITES] [${molecule_type}] ${n_sites} virtual sites found.`,
        );
        logger.warn(
          `[GO-VIRT-SITES] [${molecule_type}] Number of sites does not match number of atoms. Some bonds may not be linked correclty.`,
        );
      }

      // Clean the ITP (we don't need it anymore)
      molecule_itp.dispose();

      // Read the go table
      logger.debug(
        `[GO-VIRT-SITES] [${molecule_type}] Reading virtual Go sites table.`,
      );

      logger.verbose(
        `[GO-VIRT-SITES] [${molecule_type}] Atom bonds described: ${go_table.headlines.length - 2}.`,
      );

      // Step 3+4: Read bonds between go atoms and associate them

      // To remove duplicates (that, unfortunately, exists...), we use a map of set
      const local_bonds: { [index: number]: Set<number> } = {};

      for (const line of go_table.headlines) {
        if (line.startsWith(";")) {
          continue;
        }

        // Typical line is (may begin by spaces.)
        // molecule_0_9  molecule_0_14    1  0.7369739126  9.4140000000  ;  24  36  0.827

        // filter trim blank spaces created by regex
        const [name1, name2] = line.split(ItpFile.BLANK_REGEX).filter((e) => e);

        const go_index_1 = name_to_index[name1],
          go_index_2 = name_to_index[name2];

        if (go_index_1 === undefined || go_index_2 === undefined) {
          logger.warn(
            `[GO-VIRT-SITES] [${molecule_type}] Undefined go indexes for names ${name1}-${name2}. This should not happen...`,
          );
          continue;
        }

        const real_index_1 = index_to_real[go_index_1],
          real_index_2 = index_to_real[go_index_2];

        if (real_index_1 === undefined || real_index_2 === undefined) {
          logger.warn(
            `[GO-VIRT-SITES] [${molecule_type}] Undefined real indexes for names ${name1}(${go_index_1})-${name2}(${go_index_2}). This should not happen...`,
          );
          continue;
        }

        // We add the bonds in the set
        if (remove_duplicates) {
          const [computed_1, computed_2] =
            real_index_1 < real_index_2
              ? [real_index_1 + i, real_index_2 + i]
              : [real_index_2 + i, real_index_1 + i];

          if (computed_1 in local_bonds) {
            local_bonds[computed_1].add(computed_2);
          } else {
            local_bonds[computed_1] = new Set([computed_2]);
          }
        } else {
          bounds.push([real_index_1 + i, real_index_2 + i]);
        }
      }

      // ...Then, add the bonds
      if (remove_duplicates) {
        for (const atom in local_bonds) {
          for (const linked of local_bonds[atom]) {
            bounds.push([Number(atom), linked]);
          }
        }
      }

      // Increment i by number of atoms
      i += all_atom_count;
    }

    return { bounds, details };
  }

  protected async zip(dir: string) {
    const zip = new JSZip();

    for (const file of await FsPromise.readdir(dir)) {
      const stat = await FsPromise.stat(dir + "/" + file);

      // 10 MB max
      if (
        stat.size < 10 * 1024 * 1024 &&
        !stat.isSymbolicLink() &&
        stat.isFile()
      ) {
        const name =
          file.endsWith(".stderr") || file.endsWith(".stdout")
            ? file + ".txt"
            : file;
        zip.file(name, await FsPromise.readFile(dir + "/" + file));
      }
    }

    return zip;
  }

  /**
   * Zip a directory.
   *
   * Todo: worker thread
   * @param dir
   */
  async zipDirectory(dir: string) {
    return (await this.zip(dir)).generateAsync({
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      type: "arraybuffer",
    });
  }

  async zipDirectoryString(dir: string) {
    return (await this.zip(dir)).generateAsync({
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      type: "array",
    });
  }
})();

/*
we need to reforge this
*/

/*
    if (settings.use_go) {
      logger.debug("[Martinizer] Using GO model");
      let map_filename: string;
      let moltype: string;
      let firstResidueNumber: number;
      let nbAtomsWithoutGO: number;
      // GET THE MAP FILE FROM A CUSTOM WAY.
      // Use the original pdb file !!!
      // todo change (ccmap create way too much distances, so the shell script takes forever)
      onStep?.(this.STEP_MARTINIZE_GET_CONTACTS);
      try {
        // Get input from workfolder // input.pdb
        map_filename = await ContactMapMaker.getCcMapRCSU(inputStream as Readable, resultsPath);
      } catch (e: any) {
        logger.error("[Martinizer] ContactMapMaker.getCcMapRCSU failes");
        return Errors.throw(ErrorType.ContactMapFailed, { error: e.message })
      }

      // GL_martinize_rc REMOVE STEP GO VIRT
      try {
        const itp = await ItpFile.read(itp_files_copied[0])
        moltype = itp.name
        firstResidueNumber = parseInt(itp.atoms[0].split(" ").filter(splitElmt => splitElmt !== '')[2])
        nbAtomsWithoutGO = itp.atoms.filter(atomLine => {
          const splittedLine = atomLine.split(" ").filter(splitElmt => splitElmt !== "")
          if (splittedLine[1].includes("molecule")) return false
          else return true
        }).length
      } catch (e) {
        logger.error(e);
        return Errors.throw(ErrorType.GOComputationFailed, { error: "Error while pre computation of residue number before go virtual sites" })
      }


      logger.debug("[MARTINIZER:run] Creating Go virtual bonds");
      onStep?.(this.STEP_MARTINIZE_GO_SITES);

      // GL_martinize_rc REMOVE STEP GO VIRT

      try {

        // Any call/settings logic to create_go_virt is obsolete
        // Must create the go sites
        const goArgs = `-s input/input.pdb -f input/contact_map.txt --moltype ${moltype} --Natoms ${nbAtomsWithoutGO} --missres ${firstResidueNumber - 1}`

        const jobOptGo:JobOptAPI = {
          exportVar: {
            GO_ARGS: goArgs,
            GO_VIRT_SCRIPT: CREATE_GO_PY_SCRIPT_PATH
          },
          inputs: [ { 'input.pdb':pdb_path, 'contact_map.txt':map_filename }, CREATE_GO_PY_SCRIPT_PATH ]
        };



        // This call is obsolete
        const { stdout, jobFS } = await Executor.run('go_virt', jobOptGo)

        const new_itps = await jobFS.list('*.itp')

        for (const itpName of new_itps) {
          const targetItpPath = `${resultsPath}/${itpName}`;
          await jobFS.copy(itpName, targetItpPath);
          itp_files_copied.push(targetItpPath)
          itpContents[itpName] = await jobFS.readToStream(itpName)
          itpContentsStr[itpName] = await jobFS.readToString(itpName)
        }
        logger.debug(`[MARTINIZER:run] Creating Go virtual bonds success (${jobFS.job.id})`);
      } catch (e) {

        return Errors.throw(ErrorType.GOComputationFailed, { error: "Can't compute virtual go sites" })

      }

    }
     */
