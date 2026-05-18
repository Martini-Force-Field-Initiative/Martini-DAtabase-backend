import logger from '../logger';
import TmpDirHelper from '../TmpDirHelper';
import axios, { AxiosResponse } from 'axios';
import FormData from 'form-data';
import { Readable } from 'stream';
import { InputTextWrapper } from '../helpers/inputs';
import Executor from './Executor' ;
import { RCSU_PATH }  from '../constants';
import path from 'path';
import TarStream from 'tar-stream';
import zlib from 'zlib';
import { createWriteStream } from 'fs';
/*
Python method to implement
*/
// import {CREATE_MAP_PY_SCRIPT_PATH} from '../constants';
interface ContactMapCCMap {
    type: 'atomic';
    data: [
      /* Atom name, residue name, residue number, chain */
      [string, string, string, string],
      /* Atom name, residue name, residue number, chain */
      [string, string, string, string],
      /* Distance */
      number,
    ][];
  }

export const ContactMapMaker = new class ContactMapMaker {
  // GL :: Some Error managment ?
  async getCcMapRCSU(pdbInput: Readable|string, use_tmp_dir?: string) {
    logger.debug("GET MAP RCSU")

    if (!use_tmp_dir) {
      use_tmp_dir = await TmpDirHelper.get();
      logger.debug(`Created tmp directory for rcsu: ${use_tmp_dir}.`);
    }
    const src = InputTextWrapper(pdbInput);
    const outputFile = "output.map"
  
    const jobOpt = {
      exportVar: {
        OUTPUT: outputFile,
        RCSU_PATH: RCSU_PATH ?? ""
      },
      inputs: {
        'input.pdb': src
      },
    };
    const outputPath = path.resolve(use_tmp_dir, "./rcsu_map.out");
    //try {
    const { stdout, jobFS } = await Executor.run('map_rcsu', jobOpt)
    await jobFS.copy(outputFile, outputPath);
    // }
    // catch (e) {
    //   if (e instanceof JMError) return Errors.throw(ErrorType.JMError, { error: e.message })
    //   throw new Error(e)
    // }

    return outputPath

  }

  protected findUrlInRedirect(data: string) {
    // Find the redirect in page
    const rest = data.split('Content="0; URL=')[1];
    if (!rest) {
      throw new Error('Unable to find map URL.');
    }

    return 'http://info.ifpan.edu.pl/~rcsu/rcsu/' + rest.split('">')[0];
  }

  /**
   * Get a contact map using the contact map web-server.
   */
  async getMap(pdbInput: Readable|string, use_tmp_dir?: string) {
    // Create the initial form data job
    const form = new FormData;

    form.append('filename', InputTextWrapper(pdbInput));
    form.append('radii', 'tsai');
    form.append('fib', '14');
    form.append('allchains', '1');
    form.append('PDB_ID', '');

    // Start the job
    let res: AxiosResponse<string> = await axios.post('http://info.ifpan.edu.pl/~rcsu/rcsu/prepare.php', form, {
      headers: {
        ...form.getHeaders()
      },
      responseType: 'text'
    });

    // Follow the first redirect
    res = await axios.get(this.findUrlInRedirect(res.data), { responseType: 'text' });

    // Follow the second redirect, to the TAR file.
    // To get the tar, you should only replace .html to .tgz
    const url = this.findUrlInRedirect(res.data).replace('.html', '.tgz');

    // Save the map file inside a temporary directory
    if (!use_tmp_dir) {
      use_tmp_dir = await TmpDirHelper.get();
    }

    // Prepare the write stream for filesave
    const map_filename = path.resolve(use_tmp_dir, './output.map');
    const map_stream = createWriteStream(map_filename);

    // Download the tgz via a stream
    const map_response = await axios.get(url, { responseType: 'stream' });

    // Prepare the targz extractor, then pipe it to response stream
    const extractor = TarStream.extract();

    map_response.data
      .pipe(zlib.createGunzip())
      .pipe(extractor);

    // Assign stream download to extract only the .map file,
    // pipe the file content to the {map_stream}
    await new Promise((resolve, reject) => {
      extractor.on('entry', (header, stream, next) => {
        // {stream} is the file body, 
        // call {next} entry is read

        if (header.name.endsWith('.map')) {
          stream.on('data', chunk => {
            map_stream.write(chunk);
          });

          stream.on('end', () => {
            // ready for next entry
            next();
          });

          // Start the read stream
          stream.resume();
        }
        else {
          next();
        }
      });

      extractor.on('finish', resolve);
      extractor.on('error', reject);
    });

    map_stream.close();

    return map_filename;
  }
}

  /** GL: TO DO
   * Get a contact map using ccmap python package.
   */
  /*   async getCcMap(pdb_filename: string, use_tmp_dir?: string) {
      // Save the map file inside a temporary directory
      if (!use_tmp_dir) {
        use_tmp_dir = await TmpDirHelper.get();
        logger.debug(`Created tmp directory for ccmap: ${use_tmp_dir}.`);
      }
  
      const distances_file = use_tmp_dir + '/distances.json';
  
      logger.debug("[CCMAP] Calculating distances for backbone atoms.");
  
      const jobOpt: JobInputs = {
        exportVar: {
          WORKDIR: use_tmp_dir,
          INPUT_PDB: path.resolve(pdb_filename),
          DISTANCES: distances_file,
        },
        inputs: {},
      };
  
      const command_line = `${CREATE_MAP_PY_SCRIPT_PATH} "${path.resolve(pdb_filename)}" "${distances_file}"`
  
      // Compute contacts with the CA pdb
      try {
        await ShellManager.run(
          'ccmap',
          ShellManager.mode === "jm" ? jobOpt : command_line,
          use_tmp_dir,
          'distances',
        );
      }
      catch (e) {
        if (e instanceof JMError) return Errors.throw(ErrorType.JMError, { error: e.message })
      }
  
  
      const distances_exists = await fileExists(distances_file);
  
      if (!distances_exists) {
        throw new Error("Distance file not found. Did the ccmap run has been done fine? Check distances.stdout and distances.stderr in tmp dir.");
      }
  
      const map: ContactMapCCMap = JSON.parse(await FsPromise.readFile(distances_file, 'utf-8'));
  
      // Remove the distances.json
  
      logger.debug("[CCMAP] Creating fake rCSU contact map.");
  
      // Prepare the write stream for filesave
      const map_filename = path.resolve(use_tmp_dir + '/output.map');
      const map_stream = fs.createWriteStream(map_filename);
  
      map_stream.write(`            I1  AA  C I(PDB)    I2  AA  C I(PDB)    DISTANCE       CMs    rCSU    aSurf    rSurf    nSurf\n`);
      map_stream.write(`==========================================================================================================\n`);
  
      for (const [atom1, atom2, distance] of map.data) {
        const chain_1 = atom1[3].trim();
        const chain_2 = atom2[3].trim();
  
        const res_1 = atom1[2].trim();
        const res_2 = atom2[2].trim();
  
        map_stream.write(`R      1     1  XXX ${chain_1}    ${res_1}        2  XXX ${chain_2}    ${res_2}       ${distance}     1 1 1 1    16   2.6585   0.0000  60.5690\n`);
      }
  
      map_stream.close();
  
      return map_filename;
    } */

