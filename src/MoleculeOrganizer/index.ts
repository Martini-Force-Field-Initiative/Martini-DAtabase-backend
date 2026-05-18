import fs, { promises as FsPromise } from "fs";
import { MOLECULE_ROOT_DIR } from "../constants";
import logger from "../logger";
import { generateSnowflake, basenameWithoutExt } from "../helpers/simple";
import {
  readableToFile,
  readableToString,
  stringToStream,
} from "../helpers/inputs";
import JSZip from "jszip";
import md5File from "md5-file/promise";
import { Martinizer } from "../Builders/Martinizer";
import TopologyMaker from "../TopologyMaker";
import { inspect } from "util";
import TmpDirHelper from "../TmpDirHelper";
import { glob } from "glob";
import NodeStreamZip from "node-stream-zip";
import Errors, { ErrorType } from "../Errors";
import { MulterLikeFile } from "../types";
import { basename, dirname, extname } from "path";
import { Readable } from "stream";
import { isString } from "../types/basics";
import { ItpModOptions } from "../helpers/itp/meta_comments";
import { FileID } from "../helpers/database/types";
import { MoleculeBundle } from "../MoleculeLoaderFS/fsBundle";
import ForceFieldStore, {
  AvailableForceField,
} from "../Stores/ForceFieldStore";
import { Optional } from "../types/generics";

class MoleculeOrganizerError extends Error {}
class ErrorSaveInfo extends Error {}

type SaveOpts = {
  simple_force_field?: boolean;
  sanitizedName?: string;
};

interface ZipFileInfo {
  pdb_length: number;
  pdb_basename: string;
  top_length: number;
  top_basename: string;
  gro_length: number;
  gro_basename: string;
  itp_files_info: FileSaveInfo[];
  map_files_info: FileSaveInfo[];
}
export default new (class MoleculeOrganizer {
  static namespace: string = "";
  constructor() {
    try {
      fs.mkdirSync(MOLECULE_ROOT_DIR);
    } catch {}
  }
  setNamespace(ns: string) {
    MoleculeOrganizer.namespace = ns;
    try {
      logger.debug(
        `[MoleculeOrganizer:setNamespace] Attempting to create root dir @${MOLECULE_ROOT_DIR + "/" + ns}`,
      );
      TmpDirHelper.namespace = ns;
      fs.mkdirSync(MOLECULE_ROOT_DIR + "/" + ns);
    } catch (e: any) {
      if (!e.message.includes("EEXIST")) {
        logger.error(
          `[MoleculeOrganizer.namespace]: Cant' create \"${MOLECULE_ROOT_DIR + "/" + ns}\"`,
        );
        throw e;
      }
    }
  }
  public get rootDir() {
    return `${MOLECULE_ROOT_DIR}/${MoleculeOrganizer.namespace}/`;
  }
  /**
   * Get a ZIP, read by JSZip.
   *
   * If the save doesn't exists, returns `undefined`.
   */
  async get(file_id: FileID): Promise<[JSZip, MoleculeSaveInfo] | undefined> {
    if (await this.exists(file_id)) {
      const zip_buffer = await FsPromise.readFile(this.getFilenameFor(file_id));
      const zip = await JSZip.loadAsync(zip_buffer);

      return [zip, (await this.getInfo(file_id))!];
    }
  }

  async extract(id: FileID, in_directory: string) {
    const infos = await this.getInfo(id);
    if (!infos) {
      throw new Error("Save not found.");
    }

    const zip = new NodeStreamZip({
      file: this.getFilenameFor(id),
      storeEntries: true,
      skipEntryNameValidation: true,
    });

    await new Promise((resolve, reject) => {
      //@ts-ignore
      zip.on("ready", resolve);
      zip.on("error", reject);
    });

    function extract(input: string, output: string) {
      return new Promise<void>((resolve, reject) => {
        zip.extract(input, in_directory + "/" + output, (err: any) => {
          if (err) reject(err);
          resolve();
        });
      });
    }

    // Extract top file, pdb file and itps
    await extract(infos.top.name, "molecule.top"); // We should change that is name are sanitized
    // eg :: //await extract(infos.top.name, "molecule.top"); // track code base calls 1st ...
    await extract(infos.pdb.name, "molecule.pdb");

    for (const itp of infos.itp) {
      await extract(itp.name, itp.name);
    }

    // this throws ?
    zip.close();

    return {
      pdb: in_directory + "/molecule.pdb",
      top: in_directory + "/molecule.top",
      itps: infos.itp.map((e) => `${in_directory}/${e.name}`),
    };
  }
  /*
  Updating file(s) content and or name of a molecule
  */
  async update(
    id: FileID,
    itpFields: ItpModOptions,
    sanitizedName?: string,
  ): Promise<MoleculeSaveInfo> {
    logger.debug(`[MoleculeOrganizer:update] ${id}`);
    const ffStore = ForceFieldStore.getStore();
    const infos = await this.getInfo(id);
    if (!infos)
      throw new MoleculeOrganizerError(
        `No JSON file found @${this.getInfoFilenameFor(id)}`,
      );
    const ori_zip = this.getFilenameFor(id);
    const molBundle = await MoleculeBundle.create(ori_zip);
    await molBundle.alter(itpFields);
    const [bak_zip, bak_json] = await this.getBackupFilenamesFor(id);
    logger.debug(
      `[MoleculeOrganizer:update] Backing-up ${ori_zip} into ${bak_zip}`,
    );
    await FsPromise.copyFile(ori_zip, bak_zip);
    logger.debug(
      `[MoleculeOrganizer:update] Backing-up ${this.getInfoFilenameFor(id)} into ${bak_json}`,
    );
    await FsPromise.copyFile(this.getInfoFilenameFor(id), bak_json);

    if (molBundle.noPDB && molBundle.noGRO)
      throw new MoleculeOrganizerError(
        `No coordinate files found for:\n${inspect(molBundle.asJSON())}`,
      );
    if (molBundle.noPDB || molBundle.noGRO) {
      //     try {
      logger.warn(
        `[MoleculeOrganizer:update] ${molBundle.noPDB ? "PDB" : "GRO"} record missing generating it from ${molBundle.noPDB ? "GRO" : "PDB"} ...`,
      );
      const srcPth = molBundle.noPDB
        ? molBundle.groFilePath
        : molBundle.pdbFilePath;
      const formatted_itp_paths: { [name: string]: string } = {};
      for (const itpPath of molBundle.itpFilesPath)
        formatted_itp_paths[basename(itpPath)] = itpPath;
      const { pdb, gro } = await Martinizer.createPdbWithConect(
        srcPth,
        await readableToString(molBundle.top),
        false,
        infos.force_field,
        formatted_itp_paths,
      );
      logger.warn(
        `[MoleculeOrganizer:save] Martinizer.createPdbWithConnect generated the ${molBundle.noPDB ? "PDB" : "GRO"} missing file`,
      );
      if (molBundle.noPDB) await molBundle.setPDB(pdb);
      else await molBundle.setGRO(gro);
      /*   } catch (e) {
        logger.error(`[MoleculeOrganizer:save] Martinizer.createPdbWithConnect FAILED to generate the ${molBundle.noPDB ? 'PDB' : 'GRO'} missing file`);
      }*/
    }

    logger.debug(
      `[MoleculeOrganizer:update] Bundle info:\n${inspect(molBundle.asJSON())}`,
    );
    const zipInfo = await this.zipFromPaths(
      // Should pbbly be delegated to MoleculeBundle
      { name: basename(molBundle.pdbFilePath), path: molBundle.pdbFilePath },
      { name: basename(molBundle.groFilePath), path: molBundle.groFilePath },
      molBundle.itpFilesPath,
      molBundle.mapFilesPath,
      { name: basename(molBundle.topFilePath), path: molBundle.topFilePath },
      ori_zip, // erase previous
      sanitizedName,
    );
    logger.debug(`[MoleculeOrganizer:update] Zip completed into ${ori_zip}}`);
    const ff =
      "force_field" in itpFields ? itpFields.force_field : infos?.force_field;
    if (!ffStore.isAvailableForceField(ff))
      throw "[MoleculeOrganizer:update] unregistred Forcefield ???? ";
    const molSaveData = await this.writeMoleculeInfo(id, ori_zip, zipInfo, ff); // cast should be requried here ?

    return molSaveData;
  }
  // Returns the next available file name to perform a backup copy
  async getBackupFilenamesFor(id: FileID): Promise<[string, string]> {
    const prev = await glob(`${this.rootDir}${id}.zip*`);
    return [
      `${this.rootDir}${id}.zip.bak_${prev.length}`,
      `${this.rootDir}${id}.json.bak_${prev.length}`,
    ];
  }
  /**
   * Get the file infos attached to a save.
   */
  async getInfo(file_id: FileID): Promise<MoleculeSaveInfo | undefined> {
    if (await this.exists(file_id)) {
      return JSON.parse(
        await FsPromise.readFile(this.getInfoFilenameFor(file_id), "utf-8"),
      );
    }
  }

  /**
   * Get the ZIP filename full path.
   *
   * You can use it in express in order to make the client download ZIP
   * ```ts
   * const filename = MoleculeOrganizer.getFilenameFor("139284920");
   * res.download(filename);
   * ```
   */
  getFilenameFor(file_id: FileID) {
    return this.rootDir + file_id + ".zip";
  }

  protected getInfoFilenameFor(file_id: FileID) {
    return this.rootDir + file_id + ".json";
  }

  /**
   * List saves available.
   *
   * You can filter files you want by using a predicate on filename.
   */
  async list(
    predicate?: (file: string) => boolean,
  ): Promise<MoleculeSaveInfo[]> {
    const files = await FsPromise.readdir(this.rootDir);

    let json_files = files.filter((f) => f.endsWith(".json"));

    if (predicate) {
      json_files = json_files.filter(predicate);
    }

    // Todo in a worker ?
    return Promise.all(
      json_files.map(async (f) =>
        JSON.parse(await FsPromise.readFile(this.rootDir + f, "utf-8")),
      ),
    );
  }

  async existsMany(...file_ids: string[]) {
    for (let file_id of file_ids) {
      const a = await this.exists(file_id);
      if (!a) return a;
    }
    return true;
  }

  async exists(file_id: FileID) {
    // exists(...file_ids: string[])
    return FsPromise.access(this.getFilenameFor(file_id), fs.constants.F_OK)
      .then(() => true)
      .catch(() => {
        logger.warn(
          `[MoleculeOrganizer:exists] ${this.getFilenameFor(file_id)} not found.`,
        );
        return false;
      });
  }

  hash(file_id: string) {
    return md5File(this.getFilenameFor(file_id));
  }

  /**
   * Remove a save.
   */
  async remove(file_id: FileID) {
    try {
      await Promise.all([
        FsPromise.unlink(this.getFilenameFor(file_id)),
        FsPromise.unlink(this.getInfoFilenameFor(file_id)),
      ]);
      logger.debug("Removed save ID #" + file_id);
    } catch {}
  }

  async removeAll() {
    const dir = await FsPromise.readdir(this.rootDir);

    for (const file of dir) {
      await FsPromise.unlink(this.rootDir + file);
    }
  }
  /**
   * Copy files in tmp folder before zipping it.
   */

  async createSymlinksInTmpDir(
    dir: string,
    pdb: MulterLikeFile | undefined,
    gro: MulterLikeFile | undefined,
    top: MulterLikeFile,
    itps: MulterLikeFile[],
    maps: MulterLikeFile[],
  ) {
    const coor_full_names = [];
    for (let coorMulterLike of [pdb, gro]) {
      if (!coorMulterLike) {
        coor_full_names.push(undefined);
        continue;
      }
      const name = basename(coorMulterLike.originalname);
      const full_name = dir + "/" + name;

      // Check if pdb has extension
      const _ = name.split(".");
      const ext = _[_.length - 1];
      if (!ext) {
        throw new Error("Uploaded PDB/GRO file must have an extension");
      } else if (ext !== "pdb" && ext !== "gro") {
        throw new Error(
          `Uploaded PDB/GRO file must file extension '.pdb' or '.gro'. (${ext})`,
        );
      }
      coor_full_names.push(full_name);
      await FsPromise.symlink(coorMulterLike.path, dir + "/" + name);
    }

    const top_name = generateSnowflake() + ".top";
    const full_top_name = dir + "/" + top_name;

    await FsPromise.symlink(top.path, dir + "/" + top_name);

    const full_itp_files: string[] = [];
    for (const file of itps) {
      const itp_name = basenameWithoutExt(file.originalname) + ".itp";
      full_itp_files.push(dir + "/" + itp_name);

      await FsPromise.symlink(file.path, dir + "/" + itp_name);
    }

    const full_map_files: string[] = [];
    for (const file of maps) {
      const map_name = basenameWithoutExt(file.originalname) + ".map";
      full_map_files.push(dir + "/" + map_name);

      await FsPromise.symlink(file.path, dir + "/" + map_name);
    }

    return {
      pdb_tmp_path: coor_full_names[0],
      gro_tmp_path: coor_full_names[1],
      top_tmp_path: full_top_name,
      itps_tmp_path: full_itp_files,
      maps_tmp_path: full_map_files,
    };
  }

  /**
   * Create a JSZip object with the following data:
   *
   * @param itps_path Path to ITP files
   * @param maps_path Path to MAP files
   * @param conect_pdb Path to CONECT-ed PDB
   * @param full_top Path to built TOP
   * @param top_name Original basename of the TOP
   * @param zip_destination_path ZIP path destination
   */
  async zipFromPaths(
    //<-- Resume Here
    pdb_molecule: { name: string; path: string },
    gro_molecule: { name: string; path: string },
    itps_path: string[],
    maps_path: string[],
    full_top: { name: string; path: string },
    zip_destination_path: string,
    sanitizeName?: string,
  ): Promise<ZipFileInfo> {
    // Create ZIP
    const zip = new JSZip();

    const itp_files_info: FileSaveInfo[] = [];
    const map_files_info: FileSaveInfo[] = [];
    const targets = [itp_files_info, map_files_info];

    // Copy map and itps
    // Assigning reguilar name
    for (const item of [itps_path, maps_path]) {
      const target = targets.shift()!;

      for (const file of item) {
        // We only_change PDB/GRO and TOP file names b/c itp and map file could be referenced
        const f_name = basename(file);

        const content = await FsPromise.readFile(file);
        zip.file(f_name, content);

        target.push({
          size: content.length,
          name: f_name,
        });
      }
    }

    const top_content = await FsPromise.readFile(full_top.path);
    const top_basename = sanitizeName ? `${sanitizeName}.top` : full_top.name;
    zip.file(top_basename, top_content);

    const pdb_content = await FsPromise.readFile(pdb_molecule.path);
    const pdb_basename = sanitizeName
      ? `${sanitizeName}.pdb`
      : pdb_molecule.name;
    zip.file(pdb_basename, pdb_content);

    const gro_content = await FsPromise.readFile(gro_molecule.path);
    const gro_basename = sanitizeName
      ? `${sanitizeName}.gro`
      : gro_molecule.name;
    zip.file(gro_basename, gro_content);

    //logger.info(`[MOLECULE-ORGANIZE] Following element ZIP to disk:\n${render(zipFromPaths)}`);
    logger.debug(
      "[MoleculeOrganizer:zipFromPaths] Saving in-memory ZIP file to disk.",
    );
    let _msg = `\nPDB:\t${pdb_molecule.path} => ${sanitizeName ? `${sanitizeName}.pdb` : pdb_molecule.name}\n`;
    _msg += `GRO:\t${gro_molecule.path} => ${sanitizeName ? `${sanitizeName}.gro` : gro_molecule.name}`;
    _msg += `\nITP:\t${itps_path}`;
    _msg += `\nMAP:\t${maps_path}`;
    _msg += `\nTOP:\t${full_top.path} => ${sanitizeName ? `${sanitizeName}.top` : full_top.name}`;
    _msg += `\n==> All bundled into \t${zip_destination_path}`;
    logger.debug(
      `[MoleculeOrganizer:zipFromPaths] zipped source=>target files are ${_msg}`,
    );

    await new Promise<void>((resolve, reject) => {
      zip
        .generateNodeStream({
          streamFiles: true,
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        })
        .pipe(fs.createWriteStream(zip_destination_path))
        .on("finish", () => {
          resolve();
        })
        .on("error", (e) => {
          reject(e);
        });
    });

    return {
      gro_basename,
      pdb_basename,
      top_basename,
      pdb_length: pdb_content.length,
      top_length: top_content.length,
      gro_length: gro_content.length,
      itp_files_info,
      map_files_info,
    };
  }

  /**
   * Check, compress and save a zipped version of the given ITP and PDB file.
   *
   * Returns a save information.
   *
   * TODO & verification of ITP+PDB
   *
   * pdb_file can also be a GRO file, it doesn't matter. It is converted by GROMACS.
   */

  async save(
    pdb_file: MulterLikeFile | undefined,
    gro_file: MulterLikeFile | undefined,
    itp_files: MulterLikeFile[],
    top_file: MulterLikeFile,
    map_files: MulterLikeFile[],
    force_field: AvailableForceField,
    opt: SaveOpts,
  ): Promise<MoleculeSave> {
    logger.debug(
      `[MoleculeOrganizer:save] starting... w/ force_field '${force_field}' and options ${inspect(opt)}`,
    );
    const { simple_force_field = false, sanitizedName = undefined } = opt;
    // TODO check ITP and PDB
    // ----------------------

    // Copy the files into a tmp dir
    const use_tmp_dir = await TmpDirHelper.get();

    logger.debug(
      "[MOLECULE-ORGANIZER] Symlinking files into a temporary directory: " +
        use_tmp_dir +
        ".",
    );

    if (!pdb_file && !gro_file)
      return Errors.throw(ErrorType.InvalidMoleculeFiles, {
        dir: use_tmp_dir,
        error: new Error("Must provide/upload at least one PDB or GRO file"),
      });
    logger.debug(
      `[MoleculeOrganizer:save] ${itp_files.map((e) => e.originalname).join(", ")} || ${pdb_file ? pdb_file.originalname : gro_file?.originalname}`,
    );

    let {
      pdb_tmp_path,
      gro_tmp_path,
      top_tmp_path,
      itps_tmp_path,
      maps_tmp_path,
    } = await this.createSymlinksInTmpDir(
      use_tmp_dir,
      pdb_file,
      gro_file,
      top_file,
      itp_files,
      map_files,
    );

    // Create the modified TOP and the modified pdb

    //const itps_multer_path = itp_files.map(itp => itp.path)
    let fullTop: Readable | undefined = undefined;
    try {
      const ffForTop = simple_force_field
        ? "simple_" + force_field
        : force_field;

      fullTop = await TopologyMaker.createTopFile({
        consumer: "martinize",
        srcTopology: top_file.path,
        //itpsPath: itps_tmp_path, // No need to add it, it is already provided as srcTopology
        forcefield: ffForTop,
      });
    } catch (e) {
      logger.error(e);
      logger.warn(
        "[MoleculeOrganizer:save] Unable to create extended TOP file. Maybe the ITPs are incorrects.",
      );

      return Errors.throw(ErrorType.InvalidMoleculeFiles, {
        dir: use_tmp_dir,
        error: e,
      });
    }
    const _ = await readableToString(fullTop);
    fullTop = stringToStream(_);
    logger.debug(
      `[MoleculeOrganizer:save] Extended TOP file created, content:\n${_}`,
    );

    /**
     * One of GRO/PDB rescue
     */

    //  if(pdb_file && gro_file) {

    if (!pdb_file || !gro_file) {
      if (!pdb_file)
        logger.debug(
          `[MoleculeOrganizer:save] PDB record missing generating it from GRO...`,
        );
      else
        logger.debug(
          `[MoleculeOrganizer:save] GRO record missing generating it from PDB...`,
        );

      const { tgt_fmt, tgt_path, src_fmt, src_path } = rosetta(
        (pdb_tmp_path ? pdb_tmp_path : gro_tmp_path) as string,
      );
      gro_tmp_path = tgt_fmt === "gro" ? tgt_path : src_path;
      pdb_tmp_path = tgt_fmt === "pdb" ? tgt_path : src_path;
      try {
        const formatted_itp_paths: { [name: string]: string } = {};
        for (const itpPath of itps_tmp_path)
          formatted_itp_paths[basename(itpPath)] = itpPath;
        logger.debug(
          `[MoleculeOrganizer:rosetta] SRC: ${src_path}[${src_fmt}]  # TGT:${tgt_path}[${tgt_fmt}]`,
        );
        // Run the connect script and write coordinate output to file
        logger.debug(
          `[MoleculeOrganizer: Calling Martinizer.createPdbWithConect`,
        );
        const { pdb, gro } = await Martinizer.createPdbWithConect(
          src_path,
          await readableToString(fullTop),
          false,
          force_field,
          formatted_itp_paths,
        );
        await readableToFile(tgt_fmt === "gro" ? gro : pdb, tgt_path);
        logger.warn(
          `[MoleculeOrganizer:save] Created pdb conect for ${src_path} (input type is ${src_fmt})`,
        );
      } catch (e) {
        logger.error(
          `[MoleculeOrganizer:save] Unable to create ${tgt_fmt === "gro" ? "GRO" : "PDB"} with GROMACS. Provided files might be incorrects.:${e}`,
        );

        return Errors.throw(ErrorType.InvalidMoleculeFiles, {
          dir: use_tmp_dir,
          error: e,
        });
      }
    } // PDB or GRO recovery generation
    if (!(isString(gro_tmp_path) && isString(pdb_tmp_path)))
      return Errors.throw(ErrorType.InvalidMoleculeFiles, {
        dir: use_tmp_dir,
        error: new Error("Failed to generate PDB/GRO"),
      });
    logger.info(
      `[MoleculeOrganizer:save] PDB & GRO contents now available: Proceeding with associated files`,
    );

    // Compressing and saving
    const save_id = generateSnowflake();
    const zip_name = this.getFilenameFor(save_id);

    const final_itps = await Promise.all(
      itp_files.map(async (itp) => {
        const symlink_path = use_tmp_dir + "/" + basename(itp.originalname);
        logger.debug(
          `[MoleculeOrganizer:save] ITP content: linking ${itp.path} to ${symlink_path})`,
        );
        try {
          await FsPromise.symlink(itp.path, symlink_path);
          return symlink_path;
        } catch (e: any) {
          if (e?.code === "EEXIST") return symlink_path;
          throw e;
        }
      }),
    );

    const final_maps = await Promise.all(
      map_files.map(async (map) => {
        const symlink_path = use_tmp_dir + "/" + basename(map.originalname);
        try {
          await FsPromise.symlink(map.path, symlink_path);
        } catch (e: any) {
          if (e?.code === "EEXIST") return symlink_path;
          throw e;
        }
        return symlink_path;
      }),
    );

    const final_top = top_file.originalname.endsWith(".top")
      ? use_tmp_dir + "/" + basename(top_file.originalname)
      : use_tmp_dir + "/" + basename(top_file.originalname) + ".top";
    const top = { name: top_file.originalname, path: final_top };

    await FsPromise.symlink(top_file.path, final_top);
    logger.debug("[MoleculeOrganizer:save] Final Zipping...");
    // Compress and get save data

    const zipInfo = await this.zipFromPaths(
      { name: basename(pdb_tmp_path), path: pdb_tmp_path } /* pdb_molecule*/,
      { name: basename(gro_tmp_path), path: gro_tmp_path } /* gro_molecule*/,
      final_itps, // string[]
      final_maps, // string[]
      top, // name, path
      zip_name,
      sanitizedName,
    );

    const infos = await this.writeMoleculeInfo(
      save_id,
      zip_name,
      zipInfo,
      force_field,
    );
    logger.debug(
      "[MoleculeOrganizer:save] ZIP has been created and saved with save ID #" +
        save_id +
        ".",
    );

    return {
      id: save_id,
      name: zip_name,
      infos,
    };
  }
  /*
¨ * Update the content of the JSON description file
  */
  async writeMoleculeInfo(
    save_id: FileID,
    zip_path: string,
    data: ZipFileInfo,
    force_field: AvailableForceField,
  ): Promise<MoleculeSaveInfo> {
    logger.debug("[MOLECULE-ORGANIZER] Computing MD5 hash of ZIP file.");
    const info_name = this.getInfoFilenameFor(save_id);
    // Calculate hash
    const hash = await md5File(zip_path);

    // TODO write better infos of the ZIP in the JSON
    // Send the save data

    const infos: MoleculeSaveInfo = {
      gro: {
        size: data.gro_length,
        name: data.gro_basename,
      },
      pdb: {
        size: data.pdb_length,
        name: data.pdb_basename,
      },
      top: {
        size: data.top_length,
        name: data.top_basename,
      },
      itp: data.itp_files_info,
      map: data.map_files_info,
      hash,
      force_field,
    };
    await FsPromise.writeFile(info_name, JSON.stringify(infos));
    return infos;
  }
})();

type CoorExt = "gro" | "pdb";
interface RosettaCoor {
  src_fmt: CoorExt;
  src_path: string;
  tgt_fmt: CoorExt;
  tgt_path: string;
}

//const rosetta = (inputCoordinate:Express.Multer.File | SimuFile):RosettaCoor => {
const rosetta = (inputCoordinate: string): RosettaCoor => {
  //const src_path = inputCoordinate.path;
  const src_path = inputCoordinate;
  const wordDir = dirname(src_path);
  const src_fmt = extname(src_path).replace(".", "");
  if (src_fmt !== "pdb" && src_fmt !== "gro")
    throw new Error(`Invalid extension for input file : ${src_fmt}`);

  const name = basename(src_path, src_fmt);
  const tgt_fmt = src_fmt === "gro" ? "pdb" : "gro";
  const tgt_path = `${wordDir}/${name}${tgt_fmt}`;

  return {
    src_fmt,
    src_path,
    tgt_fmt,
    tgt_path,
  };
};

export interface FileSaveInfo {
  size: number;
  name: string;
}

export interface MoleculeSaveInfo {
  pdb: FileSaveInfo;
  itp: FileSaveInfo[];
  top: FileSaveInfo;
  map: FileSaveInfo[];
  hash: string;
  force_field: string;
  gro: FileSaveInfo;
}

export type MoleculeUpdateInfo = Optional<MoleculeSaveInfo, "force_field">;

export interface MoleculeSave {
  id: string;
  name: string;
  infos: MoleculeSaveInfo;
}
