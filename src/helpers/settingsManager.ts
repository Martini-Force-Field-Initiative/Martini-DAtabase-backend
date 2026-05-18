import { SETTINGS_FILE } from "../constants";
import { promises as FsPromise } from "fs";
import logger from "../logger";
import { generateSnowflake } from "./simple";
import { inspect } from "util";
import { GoTerm } from "../types";
import Executor from "../Builders/Executor";

export interface CategoryTree {
  [go_id: string]: {
    children: CategoryTree;
    name: string;
    dir: string;
  };
}

export interface SettingsJson {
  force_fields: string[];
  force_fields_info: ForceFielsdInfo;
  create_way: { [wayId: string]: string };
  category_tree: CategoryTree;
}
export interface ForceFielsdInfo {
  [ff_name: string]: {
    polarizable: boolean;
  };
}

export interface SettingsWrapperOptions {
  noLiveVersion: boolean;
}

interface SettingsVersions {
  martinize2: string;
  polyply: {
    engine: string;
    vermouth: string;
  };
}
/** Single json data loading point for getters ...
 * We keep json as base data format for legacy and live-post ability
 * in controller:route:settings, where settings.json can be replaced
 */
class SettingsLoadError extends Error {}
class SettingsUpdateError extends Error {}
export default class SettingsWrapper {
  private data: { [key: string]: any } = {};
  private versions: SettingsVersions = {
    polyply: {
      engine: "unknown",
      vermouth: "unknown",
    },
    martinize2: "unknown",
  };
  static instance: SettingsWrapper;

  async load() {
    try {
      const file = await FsPromise.readFile(SETTINGS_FILE, "utf-8");
      this.data = JSON.parse(file);
    } catch (e) {
      logger.error("Unable to get settings file.", e);
      throw new SettingsLoadError(`Unable to get settings file \"${e}\"`);
    }
  }

  public static async getSettingsWrapper(
    opt?: SettingsWrapperOptions,
  ): Promise<SettingsWrapper> {
    if (!SettingsWrapper.instance) {
      SettingsWrapper.instance = new SettingsWrapper();
      await SettingsWrapper.instance.load();
      if (!opt?.noLiveVersion)
        await SettingsWrapper.instance.loadServiceVersions();
    }
    return SettingsWrapper.instance;
  }

  get asTree() {
    return this.data;
  }
  get create_way() {
    return this.data.create_way;
  }
  get force_fields() {
    return this.data.force_fields;
  }
  get category_tree() {
    return this.data.category_tree;
  }
  findInCategoryTree(maybeCat: string): boolean {
    const search = (val: string, node: CategoryTree): boolean => {
      for (const go_id in node) {
        if (go_id === val) return true;

        if (node[go_id].children && search(val, node[go_id].children))
          return true;
      }
      return false;
    };

    return search(maybeCat, this.category_tree);
  }
  /**
   *
   * @param commonName return the MC:XXX value of provided common name category, case insensitive
   * @example
   * SettingsWrapper.reverse_category('Lipids') returns 'MC:0005'
   */
  reverse_category(commonName: string): GoTerm {
    const _ = commonName.toLowerCase();
    for (const cat in this.category_tree)
      if (
        _ === this.category_tree[cat].name.toLowerCase() ||
        _ === this.category_tree[cat].dir.toLowerCase()
      )
        return cat as GoTerm;
    logger.error(
      `[SettingsWrapper.reverse_category] No such category \"${commonName}\"`,
    );
    throw new Error(
      `[SettingsWrapper.reverse_category] No such category \"${commonName}\"`,
    );
  }
  get reverse_category_tree(): { [key: string]: string } {
    const reversed: any = {};
    for (const cat in this.category_tree) {
      reversed[this.category_tree[cat].dir] = cat;
    }
    return reversed;
  }
  get category_directories(): string[] {
    return Object.values(this.category_tree).map((cat: any) => cat.dir);
  }
  async write(update = true) {
    if (update) {
      const backup = `${SETTINGS_FILE}.${generateSnowflake()}`;
      await FsPromise.copyFile(SETTINGS_FILE, backup);
    }
    await FsPromise.writeFile(
      SETTINGS_FILE,
      JSON.stringify(this.data, null, 2),
    );
  }
  /**
   * backup-serialize then update the settings data and json file
   */
  async update(k: string, value: any) {
    await this.write();
    if (!(k in this.data))
      throw new SettingsUpdateError(`No such key \"${k}\"`);
    this.data[k] = value;
    await this.write(false);
  }

  get serviceVersions(): SettingsVersions {
    return this.versions;
  }

  async loadServiceVersions() {
    logger.debug("[SettingsWrapper:loadServiceVersions] Starting ...");
    // Execution of version script
    const get_it = async (service: string) => {
      const script = `set_${service}_version`;
      if (
        script !== "set_martinize_version" &&
        script !== "set_polyply_version"
      )
        throw new Error(
          "[SettingsWrapper::loadVersions] internal Error " + script,
        );

      const exportVar = { SERVICE: service };
      const { stdout, jobFS } = await Executor.run(script, { exportVar });
      logger.debug(`[SettingsWrapper:loadVersions] Getting ${service} ...`);
      const v = JSON.parse(stdout);
      logger.debug(v);
      return v;
    };

    const martiniVersion = await get_it("martinize");
    const polyplyVersions = await get_it("polyply");

    const _ = {
      ...martiniVersion,
      polyply: {
        engine: polyplyVersions.polyply,
        vermouth: polyplyVersions.vermouth,
      },
    };
    logger.debug(`Final versions map is ${inspect(_)}`);
    this.versions = _ as SettingsVersions;
  }
}
