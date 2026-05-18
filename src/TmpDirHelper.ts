import fs, { promises as FsPromise } from 'fs';
import os from 'os';
import logger from './logger';
import { simpleflake } from 'simpleflakes';
import { DEFAULT_TMP_BASE_DIR } from './constants';
import { basename } from 'path';
import { inspect } from 'util';

export type TmpDirMode = 'os' | 'directory';

/**
 * Singleton that helps managing temporary directories.
 * added namespace as opotional arg
 */
export const TmpDirHelper = new class TmpDirHelper {
  protected cache: [string, number][] = [];
  private ns?:string;

  public mode: TmpDirMode = "directory";

  constructor() {
    logger.silly(`[TmpDirHelper] base cache directory ${this.rootDir}`);
  }

  set namespace(ns:string){
    logger.debug(`[TmpDirHelper] setting namespace to ${ns}`);
    this.ns = ns;
  }

  get rootDir():string {
    const _ = this.mode ==  "directory" ? DEFAULT_TMP_BASE_DIR :  os.tmpdir();
    
    return this.ns ? `${_}${this.ns}/` : `${_}/`;
  }

  async program_clean(ttl=2, interval=2){
    logger.debug(`Program cache cleaning setup to clean every ${interval} min all directories older than ${ttl} minutes`);
    setInterval(() => {

      // Remove every item aged more than now - 45 minutes
        this.clean(
          Date.now() - (1000 * 60 * ttl)
        );
      }, 1000 * 60 * interval);
  }

  /**
   * Get a new temporary directory. Returns its path, without trailing /.
   * Eventually copying files into it.
   */
  async get(src_files?:string[]) {
    let dir: string;
    logger.silly(`[TmpDirHelper] get directory for ${src_files}`);
    if (this.mode === 'os')
      dir = await this.getRandomTmpDirFromOs();
    else
      dir = await this.getRandomTmpDirFromBaseDirectory();

    logger.debug(`[TmpDirHelper] found slot @${dir}`);
    this.cache.push([dir, Date.now()]);

    if (src_files) {
      const _ = await Promise.allSettled( 
        src_files.map( (src) => new Promise( (res, rej) => {
          FsPromise.copyFile(src, `${dir}/${basename(src)}`)
            .then(()=>res(src));
        }))
      );
    logger.silly(`[TmpDirHelper] get all set over ${inspect(_)}`);
    }

    return dir;
  }

  protected async getRandomTmpDirFromOs() {
    const tmp_dir = os.tmpdir();
    const dir = await FsPromise.mkdtemp(
      `${tmp_dir}/${this.ns ? this.ns + "/" : ''}`);
    
    return dir;
  }

  protected async getRandomTmpDirFromBaseDirectory() {
    const base = DEFAULT_TMP_BASE_DIR;
    const suffix = simpleflake().toString();
 
    const dir = `${base}${this.ns ? this.ns + "/" : ''}` + suffix;

    await FsPromise.mkdir(dir, { recursive: true });
    // Mode does not work with mkdir, must do the chmod
    await FsPromise.chmod(dir, 0o777);

    return dir
  }

  /**
   * Revoke a specific directory.
   */
  revoke(dir: string) {
    const to_remove = this.cache.filter(e => e[0].startsWith(dir));
    this.cache = this.cache.filter(e => !e[0].startsWith(dir));

    return this.removeDirectories(to_remove.map(e => e[0]));
  }

  /**
   * Remove directories that has been created before {max_timestamp}.
   * If {max_timestamp} is not specified, it cleans everything.
   */
  clean(max_timestamp = Infinity) {
    const to_remove = this.cache.filter(e => e[1] < max_timestamp).map(e => e[0]);
    if (to_remove.length === 0) {
      return Promise.resolve();
    }

    this.cache = this.cache.filter(e => e[1] >= max_timestamp);
   
    logger.debug("Removing directories: " + to_remove.join(', '));
    return this.removeDirectories(to_remove);
  }
  /**
   * Delete all fits child folder matching simplefake naming convention
   * USE W/ CAUTION !
   *  That is mostly for autoamtice cleaning of test suite runs
   */
  async nuke():Promise<unknown> {
    
      const flakeRE=/^[0-9]{19}$/;
      if (!this.ns)
        throw new Error('Cowardly refusing to delete a tmp fodler with no namespace');
      const files = (await FsPromise.readdir(this.rootDir)).filter(f=>flakeRE.test(f));
      if(!files.length) {
        logger.debug(`[TmpDirHelper] nothing to nuke @${this.rootDir}`);
      }
      logger.debug(`[TmpDirHelper] Nuking ${files.length} folders  @${this.rootDir}`);
        return Promise.allSettled( 
          files.map( f => FsPromise.rmdir(`${this.rootDir}${f}`,
        { recursive: true })));
  }

  protected removeDirectories(dir_entries: string[]) {
    for (const e of dir_entries) {
      // recursive does not work with non-sync method
      try {
        fs.rmSync(e, { recursive: true });     
      } catch {
        logger.error('[TmpDirHelper] Unable to erase temporary directory. (' + e + ')');
      }
    }
  }
};

export default TmpDirHelper;
