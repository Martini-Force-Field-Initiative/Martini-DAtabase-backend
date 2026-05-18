import CliHelper, { CliListener } from "mad-cli";
import CouchHelper, { Database } from "../../Entities/CouchHelper";
import MoleculeOrganizer, {MoleculeSaveInfo} from "../../MoleculeOrganizer";
import { Molecule, StashedMolecule } from "../../Entities/entities";
import { MoleculeLoader } from "../../MoleculeLoaderFS";
import logger from "../../logger";
import { create_top_in_dir } from "../../MoleculeLoaderFS/create_topFile";
import { cliFileSuggestor  }from 'mad-cli';
import { CONNECTED_USER_CLI } from "../user_cli";
import { isAbsolute } from 'path';
import { existsSync, writeFileSync } from 'fs';
import { render } from 'prettyjson';
import { warn, success, bold, error, renderError } from '../views';

import Statistics from './statistics';
import Loader from './loader';
import DatabaseMoleculeDesk from '../../helpers/database/molecule';
import { inspect } from "util";

const statSub = Statistics.subCommands;
const loadSub = Loader.subCommands;
const MOLECULE_CLI = new CliListener(
  CliHelper.formatHelp("molecule", {
    commands: {
    
      'get <id>': 'Get details about molecule <id>',
      'wipe <id>/all': 'Delete registred molecule <id> / all molecules',
      'find <regexp>'  : 'Find molecules w/ name or alias matching regexp',
      'latest id <mol_id> | tree <tree_id> |  NO_ARGS' : 'set the latest tag to true for a specific model | over all model of a given tree | over all trees',
      ...statSub.commands,
      ...loadSub.commands,

      /* Loader sub-commands*/
      //'parse <path>': 'Recursively search for all molecule folders in provided directory and STAGE them for future database insertion',
      //'insert <log_path>': 'Add STAGED molecules into database',
      //'gen_top <?stageID>': 'Attempt to generate top file for all STAGED molecules, optionaly one single molecule',
      //'mod_itp <?stageID>' : 'Attempt to parse ITP comments and folder architecture in order to add more informations to molecule description. Requires specific directory organization and files.',
      //'addgro <log_path>' : 'Add gro to existing entries after molecule load',
     
      //'xadd <path>' : 'Add one molecule from a zip tarball',
      
    },
    onNoMatch: "Command is incorrect. Type \"molecule\" for help.",
  })
);
MOLECULE_CLI.injector( statSub.commands, statSub.execute );
MOLECULE_CLI.injector( loadSub.commands, loadSub.execute );

MOLECULE_CLI.command('syncing', async (rest) => {
  const _ = rest.match(/([\S]+)/g);
  await DatabaseMoleculeDesk.syncing( _ == null ? undefined : _ );
});

MOLECULE_CLI.command('backup', async () => {
  const molArchiveLocation = await DatabaseMoleculeDesk.replicate();
  return success(molArchiveLocation);
});

MOLECULE_CLI.command('replicate', async (rest) => {
  rest = rest.trim();
  if (!rest)
    return warn("Please specify a target database name.");
  const molArchiveLocation =  await DatabaseMoleculeDesk.replicate(rest);
  return success(molArchiveLocation);
});

MOLECULE_CLI.command('latest', async (rest) => {
  const args = rest.split(/\s+/).filter(c => c!== '');
  if(args.length == 0) {
    await DatabaseMoleculeDesk.setLatest();
    return;
  }
  if( args.length != 2 || 
      (args[0] !== 'tree' && args[0] !== 'id') 
    )
    return error(`molecule latest takes "no argument" or "tree [treeID]" or "id [molecule ID]"`);
  if(args[0] === 'tree')
    await DatabaseMoleculeDesk.setLatest({tree_id:args[1]});
  if(args[0] === 'id')
    await DatabaseMoleculeDesk.setLatest({id:args[1]});
});

MOLECULE_CLI.command('get', async rest => {
  rest = rest.trim();
  if (!rest)
    return warn("Please specify a molecule id.");

  try {
    BigInt(rest);
  } catch (e) {
    return error(`ID ${rest} is not valid, please enter a valid number.`);
  }

  try {
    return Database.molecule.get(rest);
  } catch (e) {
    return Database.stashed.get(rest);
  }
});

MOLECULE_CLI.command('wipe', async rest => {
  rest = rest.trim();
  
  if (!rest)
    return warn("Please specify a molecule id or \"all\"");

  if (rest === "all") {
    await Database.delete('molecule');
    await Database.delete('stashed');
    await MoleculeOrganizer.removeAll();
    await Database.create('molecule');
    await Database.create('stashed');
    return `Molecule database is wiped`;
  }

  try {
    BigInt(rest);
  } catch (e) {
    return error(`ID ${rest} is not valid, please enter a valid number.`);
  }

  let mol: Molecule | undefined = undefined;
  let stash: StashedMolecule | undefined = undefined;
  try {
    mol = await Database.molecule.get(rest);
  } catch (e) {
    try {
      stash = await Database.stashed.get(rest);
    } catch {
      return warn(`Unable to get molecule (${rest})`);
    }
  }

  if (mol) {
    await MoleculeOrganizer.remove(mol.files);
    return Database.molecule.delete(mol);
  }
  else if (stash) {
    await MoleculeOrganizer.remove(stash.files);
    return Database.stashed.delete(stash);
  }
  return `Unable to find molecule.`
});



/* BATCH OPERATIONS LOGIC */

MOLECULE_CLI.command('parse', rest => {
  
  /* Uncomment for prod 
  if (!CONNECTED_USER_CLI) 
    return 'Please connect before using this command by using user connect';
  
  if (CONNECTED_USER_CLI.role != 'admin')
    return 'You must be admin to add molecules to the database'
  
  if (!rest)
    return 'please specify a molecule type and a files path';

  
    MoleculeLoader.connect(CONNECTED_USER_CLI) <-- finish this
  */

  let params = rest.split(' ');
  let path = params[0].trim();
  if (!isAbsolute(path))
    return warn(`Path "${path}" must be absolute`);
  if (!existsSync(path)) 
    return warn(`Path "${path}" does not exist`);
  //logger.warn(resolve(__dirname, path))
    logger.warn( __dirname );
    const maybeErrors = MoleculeLoader.add(path);
   /* DEPRECATED w/ MoleculeLoaer rehaul */
   let msg = bold(`Batched ${MoleculeLoader.length()} molecules\n\n`);
    if (maybeErrors) {
      msg += warn(`Reporting ${Object.keys(maybeErrors).length} problematic molecule folder(s):\n`);
      msg += renderError(maybeErrors)
    }
    msg += success(`\n\nReporting ${MoleculeLoader.length()} regular molecule folders`);
    if ( !MoleculeLoader.isEmpty() )
      msg += `\n${render(MoleculeLoader.status())}`;
    
    return msg;
    
    
}, {
  onSuggest: cliFileSuggestor,
});

/*
MOLECULE_CLI.command('tmpversion', async () => {
  await correctVersions()

})
*/
MOLECULE_CLI.command('build', rest => {
  /**
   * Browsing all registered ok folders:
   * - creating tmp folder
   * - producing the itps
   */

});

MOLECULE_CLI.command('fix', rest => {
  /**
   * Browsing all registered ok folders:
   * - creating tmp folder if needed
   * - producing the gro if a pdb was provided
   */

});

MOLECULE_CLI.command('insert', async rest => {
  rest = rest.trim();
  if(!rest)
    console.log(warn("No log file to write insertion recap"));
  
  let logged = "# MAD molecules batch insertion";
  
  
  if (!CONNECTED_USER_CLI)
    return warn('Please connect before using this command by using user connect');
  
    MoleculeLoader.connect(CONNECTED_USER_CLI.id, CONNECTED_USER_CLI.role);
  if ( MoleculeLoader.isEmpty() )
    return warn('Missing molecules in memory. Please insert them by using molecule load.');

  try {
    const recapInsertion = await MoleculeLoader.insert();
    logged += render(recapInsertion)

    if(logged !== '' && rest) writeFileSync(rest, logged)
    
  } catch (e:any) {
    console.error(e)
    logger.warn(e.data !== undefined ? e.data.message : e);
  }
});

/* TMP GLA UP */
MOLECULE_CLI.command('find', async (subString:string) => {
  const mols = await Database.molecule.all();
  const re = new RegExp(subString,"g");
  const foundMol = mols.filter( (m:Molecule) => m.alias.match(re) || m.name.match(re));
  let res = `\t\tFound ${foundMol.length} matching elements\n\n`;
  foundMol.forEach( (m,i) => 
    res += `\n\x1b[31m######################\n#\tHit ${i + 1}\x1b[0m\n\n${render(m)}\n`
  );
  return res;
});

MOLECULE_CLI.command('set_batch_tag', async (subString:string) => {
  /**
   * Placeholder, we work on itp comment field parsing first.
   * For automatic setting of tag values at file insertion
   */
    if (MoleculeLoader.isEmpty()) 
      return 'Missing molecules in memory. Please insert them by using molecule load.';
    
})

MOLECULE_CLI.command('files', async (molecule_id:string) => {
  const mol = await Database.molecule.get(molecule_id);
  if (!mol) 
    return `No such molecule wit ID \"${molecule_id}\"`;
  const files_info = await MoleculeOrganizer.getInfo(mol.files);
  return "\n" + render(files_info);

});


MOLECULE_CLI.command('check_files', async () => {
  //rest = rest.trim();
  const mols = await Database.molecule.all();
  const mol_files:[string, MoleculeSaveInfo|undefined][] = await Promise.all(mols.map(async (m) => [ m._id, await MoleculeOrganizer.getInfo(m.files)] ));
  const to_fix = mol_files
    .filter( ([id, info]) => { if(!info) return false; return ! ('gro' in info  && 'pdb' in info)})
    .map(([id, info]) => [id, MoleculeOrganizer.getFilenameFor(id), info])
  let n_gro = 0
  let n_pdb = 0;
  for (const [id, file, info] of to_fix) {
    if (! ('gro' in  (info as MoleculeSaveInfo)) )
      n_gro++;  
      if (! ('pdb' in  (info as MoleculeSaveInfo)) )
        n_pdb++;  
    console.dir(info);
  }
  console.log(`${n_gro} missing GRO, ${n_pdb} missing PDB`);
});



/* BATCH MOLECULES LOGIC (shall be moved to "loader.ts/stage.ts")
*/

MOLECULE_CLI.command('view_batch', () => {
  return render( MoleculeLoader.status() );
});
/**
 * Remove all STAGED molecule or optionaly only a single one specified by the (optional)ID parameter
 */
MOLECULE_CLI.command('del_staged', (batchID:string|undefined) => {
  MoleculeLoader.deleteFromBatch(batchID);
  //return render( MoleculeLoader.get_info() );
});



/* TMP GLA DOWN */

// CC Error needs type
MOLECULE_CLI.command('gen_top', rest => {
  rest = rest.trim();

  if (!existsSync(rest))
    return `Path ${rest} is not valid`;

  try {
    create_top_in_dir(rest);
    return `top files created @${rest}`;
  } catch (e:any) {
    return `top files creation error:\n @${e.data}`;
  }
}, {
  onSuggest: cliFileSuggestor,
})

/** Complete the ITP comment section of all molecule currently STAGED of only a single 
 * one if not parameter is provided
 * TO IMPLEMENT
*/
MOLECULE_CLI.command('mod_itp', (batchID:string|undefined) =>  {

  if(batchID) {
    const batchElem = MoleculeLoader.getFromBatch(batchID)
    logger.debug("I found a moleculke ID " + batchElem);
  }
  /*try { // ATTACH THIS TI BATCH ELEMENT !!
    MoleculeLoader.GenerateModItpFiles(path, true)
  } catch(e) {
    return `Error while attempting to modify itp\n:${e}`;
  }*/
}, {
  onSuggest: cliFileSuggestor,
})

/* This should be deprecated in favor of fix */

MOLECULE_CLI.command('addgro', async logfile => {
  logfile = logfile.trim();
  let logged = ''
  if(! logfile) {
    logger.warn("No log file to write insertion recap")
  }
  else {
    logged = "# MAD molecule add gro recap"
  }
  
  if (MoleculeLoader.isEmpty()) 
    return 'Missing molecules in memory. Please insert them by using molecule load.'

//  await MoleculeLoader.addGroFiles();

})

export default MOLECULE_CLI;
