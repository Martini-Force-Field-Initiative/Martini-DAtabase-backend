//import { VanDerWaalsRadius } from "./entities";
//import AbstractDatabase from "./AbstractDatabase";
import logger from "../logger";
import { inspect } from "util";
import fs, { promises as FsPromise, promises } from "fs";
import { normalize as normalizePath } from "path";

import {
  FORCE_FIELD_DEF,
  FORCE_FIELD_DIR,
  INSANE_DEF_LIPID_DIR,
} from "../constants";

export const ffBundleKeys = [
  "martini3001",
  "elnedyn22p",
  "elnedyn22p",
  "elnedyn22",
  "elnedyn",
  "martini22",
  "martini22p",
  "martini23_CNP",
  "martini3 lipidome",
  "martini3IDP",
];
export type ffBundleKey = (typeof ffBundleKeys)[number];

export const isFfBundleKey = (o: unknown): o is ffBundleKey => {
  return typeof o === "string" && ffBundleKeys.includes(o);
};

export type AvailableForceField = string;
export type AvailableVermouthLib = string;

export const BASE_DEFAULT_FORCEFIELD: AvailableForceField = "martini22";
class ForceFieldLoadError extends Error {}
import { VermoutLib, parseVermouthLib, PolyplyTargetLib } from "./Vermouth";
import { MetadataCollection } from "../controllers/dto/dto_base";
interface ForceFieldInfo {
  polarizable: boolean;
  //type: FF_TYPE,
  downloadable: boolean;
  insane_support: boolean;
  martinize2_support: boolean;
  virtual: boolean;
  polyply_lib_support?: PolyplyTargetLib;
  metadata?: {
    comments: string;
    cite: string;
  };
}

interface CompatibilityItem {
  from: ffBundleKey;
  to: ffBundleKey[];
}
/*
  --Depedency forcefield managment strategy--
  All properties except virtual are inherited from the parent
  Files from parent are prepended to the children

  Item annotated as virtual won't be passed to the client
*/

export interface ForceFieldItemVirt {
  name: string;
  files: string[];
  weight: number;
  insane_def?: string;
}
export interface ForceFieldItemTmp extends ForceFieldItemVirt {
  info: Partial<ForceFieldInfo>;
  refers_to: string;
}
export interface ForceFieldItem extends ForceFieldItemVirt {
  info: ForceFieldInfo;
}
export default class ForceFieldStore {
  static instance: ForceFieldStore;

  public static async setStore(namespace: string): Promise<void> {
    logger.info(`ForceFieldStore:setStore for namespace '${namespace}'`);
    //try {
    ForceFieldStore.instance = new ForceFieldStore(namespace);
    await ForceFieldStore.instance.load();

    //logger.info(`### ${inspect(ForceFieldStore.instance.tree["martini3IDP"])}`);
    /*} catch(e) {
      logger.error(`Throwing from SetStore factory, inspecting error object: ${e}`);

      throw new Error(`ForceFieldStore: location ${namespace} is not valid`);
    }*/
  }

  public static getStore(): ForceFieldStore {
    if (!ForceFieldStore.instance) {
      throw new Error(`ForceFieldStore:store not initialized`);
      /*
      ForceFieldStore.instance = new ForceFieldStore();
      await ForceFieldStore.instance.load();
      */
    }
    return ForceFieldStore.instance;
  }

  tree: { [k: string]: ForceFieldItem } = {};
  _compatibilityMatrix: CompatibilityItem[] = [];
  forceFieldDataDir: string;
  vermouthLibs: Record<string, VermoutLib> = {};

  constructor(private ns: string) {
    this.forceFieldDataDir = normalizePath(`${FORCE_FIELD_DIR}/${this.ns}`);
    // This reduncandy in messages is due to the fact that we cannot catch
    // in the main script, for yet unknown reason,
    //  the error thrown by the constructor
    if (!fs.existsSync(this.forceFieldDataDir)) {
      logger.error(
        `ForceFieldStore: location ${this.forceFieldDataDir} not found`,
      );
      throw new Error(
        `ForceFieldStore: location ${this.forceFieldDataDir} not found`,
      );
    }
    if (!fs.statSync(this.forceFieldDataDir).isDirectory()) {
      logger.error(
        `ForceFieldStore: location ${this.forceFieldDataDir} is not a directory `,
      );
      throw new ForceFieldLoadError(
        `ForceFieldStore: location ${this.forceFieldDataDir} is not a directory `,
      );
    }
  }

  static isForceFieldItemTmp(o: any): o is ForceFieldItemTmp {
    if ({}.toString.call(o) !== "[object Object]")
      throw new Error(
        `ForceFieldStore:isForceFieldItemTmp unknown element ${inspect(o)}`,
      );
    return "refers_to" in o;
  }

  static parseForceFieldItem(
    o: any,
    rank: number,
  ): ForceFieldItem | ForceFieldItemTmp {
    /**
     *  The insane_def value is not inherited
     */
    if ({}.toString.call(o) != "[object Object]")
      throw `ForceFieldStore:parseForceFieldItem unknown ForceFieldItem ${inspect(o)}`;
    if (!("name" in o))
      throw `ForceFieldStore:parseForceFieldItem has no name  ${inspect(o)}`;

    const ffItem = {
      name: o.name,
      files: o.files ?? [],
      weight: rank,
      insane_def: o.insane_def ?? undefined,
    };

    if (o.hasOwnProperty("refers_to"))
      return {
        ...ffItem,
        info: o.hasOwnProperty("info")
          ? ForceFieldStore.parseInfo(o.info, true)
          : {},
        refers_to: o.refers_to,
      } as ForceFieldItemTmp;

    return {
      ...ffItem,
      info: o.hasOwnProperty("info")
        ? ForceFieldStore.parseInfo(o.info, false)
        : {},
    } as ForceFieldItem;
  }

  private static parseInfo(
    o: any,
    fromForceFieldTmp = false,
  ): Partial<ForceFieldInfo> | ForceFieldInfo {
    /**
     * The only forcefield info field that is autoamtically set is the virtual property
     * All the other fields (but metadata, insane_support, polyply_lib_support and downloadable)
     *  are optional and may be inherited from the parent
     */
    if ({}.toString.call(o) != "[object Object]")
      throw `ForceFieldStore:parseInfo unknown ForceFieldInfo ${inspect(o)}`;

    if (!fromForceFieldTmp)
      return {
        virtual: o?.virtual ?? false,
        polarizable: o?.polarizable ?? false,
        downloadable: o?.downloadable ?? false,
        metadata: o?.metadata ?? undefined,
        insane_support: o?.insane_support ?? false,
        polyply_lib_support: o?.polyply_lib_support ?? undefined,
        martinize2_support: o?.martinize2_support ?? false,
      } as ForceFieldInfo;

    const _: Partial<ForceFieldInfo> = {
      virtual: o?.virtual ?? false,
    };

    if (o.polarizable !== undefined) _.polarizable = o.polarizable;
    if (o.downloadable !== undefined) _.downloadable = o.downloadable;
    if (o.insane_support !== undefined) _.insane_support = o.insane_support;
    if (o.polyply_lib_support !== undefined)
      _.polyply_lib_support = o.polyply_lib_support;
    if (o.martinize2_support !== undefined)
      _.martinize2_support = o.martinize2_support;
    if (o.metadata !== undefined) _.metadata = o.metadata;
    return _;
  }
  private static parseCompatibilityMatrix(data: {}): CompatibilityItem[] {
    const rootKey = "martinize2sytemBuilder_compatibiliy_matrix";
    if (!(rootKey in data))
      throw `ForceFieldStore:parseCompatibilityMatrix "${rootKey}" not found in settings ${inspect(data)}`;
    if (!Array.isArray(data[rootKey]))
      throw `ForceFieldStore:parseCompatibilityMatrix "${rootKey}" is not an array ${inspect(data[rootKey])}`;

    // Basic check
    data[rootKey].forEach((e) => {
      if (!("from" in e))
        throw `ForceFieldStore:parseCompatibilityMatrix item has no "from" field ${inspect(e)}`;
      if (!isFfBundleKey(e.from))
        throw `ForceFieldStore:parseCompatibilityMatrix item "from" field is not a known force field ${inspect(e)}`;
      if (!("to" in e))
        throw `ForceFieldStore:parseCompatibilityMatrix item has no "to" field ${inspect(e)}`;
      if (!Array.isArray(e.to))
        throw `ForceFieldStore:parseCompatibilityMatrix item "to" field is not an array ${inspect(e)}`;
      e.to.forEach((e2: string) => {
        if (!isFfBundleKey(e2))
          throw `ForceFieldStore:parseCompatibilityMatrix item "to" field is not a known force field ${inspect(e)}`;
      });
    });
    return data[rootKey] as CompatibilityItem[];
  }
  async load() {
    logger.info("ForceFieldStore:load from " + FORCE_FIELD_DEF);
    let data: {};
    try {
      const file = await FsPromise.readFile(FORCE_FIELD_DEF, "utf-8");
      data = JSON.parse(file);
    } catch (e) {
      logger.error("Unable to get force field definition file.", e);
      throw new ForceFieldLoadError(
        `Unable to get force field definition file \"${e}\"`,
      );
    }

    // Loading vermouth ff files collections
    if (!("vermouth_library" in data))
      throw `ForceFieldStore:load root element 'vermouth_library' not found`;
    if (!Array.isArray(data["vermouth_library"]))
      throw `ForceFieldStore:load root element 'vermouth_library' is not an array`;
    data.vermouth_library.forEach((e: any) => {
      const vl = parseVermouthLib(e);
      this.vermouthLibs[vl.name] = vl;
    });

    // Loading itp includes collection
    this._compatibilityMatrix = ForceFieldStore.parseCompatibilityMatrix(data);
    const bufferTree: { [k: ffBundleKey]: ForceFieldItem | ForceFieldItemTmp } =
      {};

    if (!("forcefield_by_ascend_version" in data))
      throw `ForceFieldStore:load root element 'forcefield_by_ascend_version' not found`;
    const ff_items = data["forcefield_by_ascend_version"];
    if (!Array.isArray(ff_items))
      throw `ForceFieldStore:load root element 'forcefield_by_ascend_version' is not an array`;

    ff_items.forEach((ffItem: any, i: number) => {
      const _ = ForceFieldStore.parseForceFieldItem(ffItem, i);
      bufferTree[_.name as ffBundleKey] = _;
    });

    // Edit references, 1st pass it is undefined or a string
    // We initialize the final tree
    for (const [ffKey, ffItem] of Object.entries(bufferTree)) {
      if (!ForceFieldStore.isForceFieldItemTmp(ffItem)) {
        this.tree[ffKey] = ffItem;
        continue;
      }

      if (!bufferTree.hasOwnProperty(ffItem.refers_to as string))
        throw `ForceFieldStore:load unknown refered ForceFieldItem ${ffItem.refers_to}`;
    }

    // Remove concrete ForceFieldItem from buffer
    for (const ffKey in this.tree) delete bufferTree[ffKey];

    // 2nd pass ?refers_to are now ForceFieldItem
    // Exhausting the buffer tree
    while (Object.keys(bufferTree).length > 0) {
      for (const [ffKey, ffItem] of Object.entries(bufferTree)) {
        if (!ForceFieldStore.isForceFieldItemTmp(ffItem))
          throw new Error(
            `ForceFieldStore:load unexpected concrete ForceFieldItem in buffer ${inspect(ffItem)}`,
          );

        if (!(ffItem.refers_to in this.tree)) continue;

        const parent = this.tree[ffItem.refers_to];
        // We merge with valid parent and push into final tree
        this.tree[ffKey] = {
          files: parent.files.concat(ffItem.files),
          weight: ffItem.weight,
          info: {
            polarizable: ffItem.info.polarizable || parent.info.polarizable,
            metadata: ffItem.info.metadata || undefined, // polyply_lib_support support is not inherited
            downloadable: ffItem.info.downloadable || false, // downloadable support is not inherited
            insane_support:
              ffItem.info.insane_support !== undefined // insane_support is a boolean
                ? ffItem.info.insane_support
                : parent.info.insane_support, // Trying to make insane support inherited
            polyply_lib_support: ffItem.info.polyply_lib_support || undefined, // polyply_lib_support support is not inherited
            martinize2_support:
              ffItem.info.martinize2_support || parent.info.martinize2_support,
            virtual: ffItem.info.virtual || false,
          },
          insane_def: ffItem.insane_def || parent.insane_def,
        } as ForceFieldItem;
      }
      const edited = Object.keys(bufferTree).filter(
        (k: string) => k in this.tree,
      );
      if (edited.length == 0)
        throw `ForceFieldStore:load unresolved refered ForceFieldItem ${inspect(bufferTree)}`;

      for (const k of edited) delete bufferTree[k];
    }

    // Sanity Check
    // All registred ffBundle should be in the tree
    ffBundleKeys.forEach((ffKey) => {
      if (!this.tree.hasOwnProperty(ffKey))
        throw `ForceFieldStore:load missing ForceFieldItem ${ffKey}`;
    });
    this._compatibilityMatrix.forEach((_: CompatibilityItem) => {
      const e = [_.from, ..._.to];
      e.forEach((ffKey) => {
        if (!this.tree.hasOwnProperty(ffKey))
          throw `ForceFieldStore:load missing compatibility matrix ForceFieldItem ${ffKey}`;
        if (!this.tree[ffKey].info.insane_support)
          throw `ForceFieldStore:load compatibility matrix ForceFieldItem  ${ffKey} is not insane compatible`;
      });
    });
    logger.debug(
      `ForceFieldStore: All forcefields dependencies and compatablity matrix build`,
    );
    logger.debug(`ForceFieldStore: Asserting files locations`);
    this._assertFilesExistences();
    logger.debug(
      `ForceFieldStore: load complete [NS:${this.ns}] as\n${inspect(this.tree, { depth: 4 })}\n${inspect(this.vermouthLibs)}`,
    );
  }

  allForceFiedFilesAbsPath(): string[] {
    const files: string[] = [];
    for (const ffItem of Object.values(this.tree)) {
      if (ffItem.hasOwnProperty("files"))
        files.push(
          ...ffItem.files.map((f) => `${this.forceFieldDataDir}/${f}`),
        );
    }
    return files;
  }
  anyForceFiedFileAbsPath(basename: string): string {
    // Not tested, not used
    const files: string[] = [];
    for (const ffItem of Object.values(this.tree)) {
      if (ffItem.hasOwnProperty("files"))
        for (const f of ffItem.files)
          if (f == basename) return `${this.forceFieldDataDir}/${f}`;
    }
    logger.error(
      `ForceFieldStore:anyForceFiedFileAbsPath no such file ${basename}`,
    );
    throw new Error(
      `ForceFieldStore:anyForceFiedFileAbsPath no such file ${basename}`,
    );
  }

  private _assertFilesExistences(): void {
    for (const ffItem of Object.values(this.tree)) {
      if (ffItem.hasOwnProperty("files"))
        for (const file of ffItem.files.map(
          (f) => `${this.forceFieldDataDir}/${f}`,
        ))
          try {
            fs.accessSync(file, fs.constants.F_OK);
          } catch (error) {
            throw `ForceFieldStore:_assertFilesExistences file ${file} does not exist`;
          }
    }
  }

  /* -- GETTTERS -- */

  public getForceFieldItem(ffKey: string) {
    // Returns a ff bundle which is not "virtual", virtual may be still access W/ optional parameter (to implement)
    if (!this.isAvailableForceField(ffKey))
      throw `ForceFieldStore:getForceFieldItem no such forceField '${ffKey}'`;
    return this.tree[ffKey];
  }
  get availableForceFields(): string[] {
    // Returns all bundle names which are not "virtual"
    const noVirtualFfKeys: string[] = [];
    Object.entries(this.tree).forEach(([ffKey, ffItem]) => {
      if (!ffItem.info.virtual) noVirtualFfKeys.push(ffKey);
    });
    return noVirtualFfKeys;
  }
  /**
   * Given a forcefield key, returns a list of files basename of the given forcefield
   * @param {string} ffKey - key of the forcefield
   * @returns {string[]} list of files basename of the given forcefield
   * @throws {Error} if the forcefield does not exist
   */
  public getFilesForForceField(ffKey: string): string[] {
    return this.getFilesForForceFieldOrVermouthLib(ffKey);
  }

  public getFilesForForceFieldOrVermouthLib(ffOrVlibKey: string): string[] {
    if (
      !this.isAvailableForceField(ffOrVlibKey) &&
      !this.isAvailableVermouthLib(ffOrVlibKey)
    ) {
      logger.warn(
        `ForceFieldStore:getFilesForForceFieldOrVermouthLib no such forcefield or vermouth lib '${ffOrVlibKey}'`,
      );
      return [];
    }

    const loc =
      ffOrVlibKey in this.tree
        ? this.tree[ffOrVlibKey]
        : this.vermouthLibs[ffOrVlibKey];
    return loc.files;
  }
  /**
   * return a list of full paths to files of the given forcefield
   * @param ffKey the key of the forcefield
   * @returns a list of full paths to the forcefield files
   */
  public getCompleteFilesForForceField(ffKey: string): string[] {
    if (!this.isAvailableForceField(ffKey)) {
      logger.warn(
        `ForceFieldStore:getForceFieldItem no such forceField '${ffKey}'`,
      );
      return [];
    }
    return this.getFilesForForceFieldOrVermouthLib(ffKey).map(
      (f) => `${this.forceFieldDataDir}/${f}`,
    );
  }
  public getCompleteFilesForVermouthLib(vlibKey: string): string[] {
    if (!(vlibKey in this.vermouthLibs)) {
      logger.warn(
        `ForceFieldStore:getCompleteFilesForVermouthLib no such forceField '${vlibKey}'`,
      );
      return [];
    }
    return this.getFilesForForceFieldOrVermouthLib(vlibKey).map(
      (f) => `${this.forceFieldDataDir}/${f}`,
    );
  }

  public getCompleteFilesForForceFieldOrVermouthLib(
    ffOrVlibKey: string,
  ): string[] {
    const files = this.getFilesForForceFieldOrVermouthLib(ffOrVlibKey);
    if (files.length === 0)
      // throw ?
      return [];

    return files.map((f) => `${this.forceFieldDataDir}/${f}`);
  }

  isAvailableForceField(o: any): o is AvailableForceField {
    if (typeof o !== "string") return false;
    return this.availableForceFields.includes(o);
  }
  isAvailableVermouthLib(o: any): o is AvailableVermouthLib {
    if (typeof o !== "string") return false;
    return o in this.vermouthLibs;
  }

  generateClientSettings(noVirtual = true) {
    /*
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
      "elnedyn":{"polarizable": false, "martinize2_support":true,
      "insane_support":true, downloadable" : false},
    },
    */
    const force_fields: string[] = [];
    const force_fields_info: { [k: string]: ForceFieldInfo } = {};
    const vermouthLibs_info: { [k: string]: ForceFieldInfo } = {};
    Object.entries(this.tree)
      .sort(
        ([ffk1, ffItem1], [ffk2, ffItem2]) => ffItem1.weight - ffItem2.weight,
      )
      .filter(([ffk, ffItem]) => !noVirtual || !ffItem.info.virtual)
      .forEach(([ffk, ffItem]) => {
        force_fields.push(ffk);
        force_fields_info[ffk] = ffItem.info;
      });

    return {
      force_fields,
      force_fields_info,
      vermouth_libs_info: this.vermouthLibs,
    };
  }

  get forceFieldsInfo() {
    // Just filter out files property and return
    logger.warn(inspect(this.tree));
    const ff_info: { [k: string]: ForceFieldInfo } = {};
    for (const ff in this.tree) ff_info[ff] = this.tree[ff].info;

    return ff_info;
  }

  get insaneForceFieldDefFile(): [ffBundleKey, JsonDefAbsPath: string][] {
    return Object.entries(this.tree)
      .filter(([ff, ffItem]) => ffItem.insane_def != undefined)
      .map(
        ([ff, ffItem]) =>
          [ff, `${INSANE_DEF_LIPID_DIR}/${ffItem.insane_def}`] as [
            ffBundleKey,
            string,
          ],
      );
  }
  compatibleForceFieldsVector(ffKey: string): ffBundleKey[] {
    if (!this.isAvailableForceField(ffKey))
      throw `ForceFieldStore:compatibilityMatrixFor no such forceField '${ffKey}'`;
    for (const elem of this._compatibilityMatrix) {
      if (elem.from == ffKey) return elem.to;
    }
    return [ffKey]; // Only compatible with itself
  }

  getProductionFile(fname: "em.mdp" | "run.mdp"): string {
    return `${this.forceFieldDataDir}/${fname}`;
  }

  get polyplyEnvironments(): Record<string, string> {
    /*
    Get key/values pairs of the type "my_Environement" : "martini2"|"martini3"
    */
    const res: Record<string, string> = {};
    for (const [ffKey, ffItem] of Object.entries(this.tree)) {
      if (ffItem.info.polyply_lib_support !== undefined) {
        res[ffKey] = ffItem.info.polyply_lib_support;
      }
    }
    for (const [vLibName, vLib] of Object.entries(this.vermouthLibs)) {
      res[vLibName] = vLib.target_polyply_lib;
    }
    logger.debug(`ForceFieldStore:polyplyEnvironments ${inspect(res)}`);
    return res;
  }

  get availableVermouthLibs(): string[] {
    return Object.values(this.vermouthLibs).map((vLib) => vLib.name);
  }
  getVermouthLibraryFilePaths(libName: string): string[] {
    if (!this.vermouthLibs[libName])
      throw `ForceFieldStore:getVermouthLibraryFilePaths no such library '${libName}'`;
    return this.vermouthLibs[libName].files.map(
      (f) => `${this.forceFieldDataDir}/${f}`,
    );
  }

  isSuperSetOf(ff1: string, ff2: string): boolean {
    /* returns true if ff1 list of files is a superset of ff2 list of files */
    const l1 = this.getFilesForForceField(ff1);
    if (l1.length == 0)
      throw `ForceFieldStore:isSuperSetOf no such forceField '${ff1}'`;
    const l2 = this.getFilesForForceField(ff2);
    if (l2.length == 0)
      throw `ForceFieldStore:isSuperSetOf no such forceField '${ff2}'`;

    return l2.every((f) => l1.includes(f));
  }

  get metadata(): MetadataCollection {
    return {
      ...Object.entries(this.tree).reduce((acc, [ffKey, ffItem]) => {
        if (ffItem.info.metadata !== undefined)
          acc[ffKey] = ffItem.info.metadata;
        return acc;
      }, {} as MetadataCollection),
      ...Object.values(this.vermouthLibs).reduce((acc, vLib) => {
        if (vLib.metadata !== undefined) acc[vLib.name] = vLib.metadata;
        return acc;
      }, {} as MetadataCollection),
    };
  }
}
