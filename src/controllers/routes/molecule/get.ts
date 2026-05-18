import { Router } from 'express';
import { errorCatcher, sanitize, methodNotAllowed, escapeRegExp } from '../../../helpers/simple';
import { Database } from '../../../Entities/CouchHelper';
import nano = require('nano');
import Errors, { ErrorType } from '../../../Errors';
import { Molecule } from '../../../Entities/entities';
import logger from '../../../logger';
import {inspect} from 'util';

const GetMoleculeRouter = Router();

GetMoleculeRouter.get('/', (req, res) => {
  (async () => {
    logger.debug(`[Router:Molecule:get] ${inspect(req.query)}`);
    const { alias, version, tag, force_field } = req.query; // force_field TO DO
    
    if (!alias) {
      return Errors.throw(ErrorType.MissingParameters);
    }

    const selector: any = { alias: { $regex: '(?i)^' + escapeRegExp(alias as string) + '$' } };
    if (force_field)
      selector.force_field = force_field;


    let search_specific_version = false;
    if (version) {
      selector.id = version;
      search_specific_version = true;
    }
    if (tag) {
      selector.version = tag;
      search_specific_version = true;
    }

    const query: nano.MangoQuery = { selector };

    const desired_molecule = await Database.molecule.find(query);

    if (!desired_molecule.length) {
      return Errors.throw(ErrorType.ElementNotFound);
    }

    const molecule = desired_molecule[0];
    const tree_id = molecule.tree_id;

    // Find all versions
    const versions = await Database.molecule.find({ selector: { tree_id }, limit: 9999999 });

    let good_version: Molecule = molecule;
  
    if (!search_specific_version) {
      logger.info("[Router:Molecule:get] Find the last version of the molecule by latest tag preferably");
      // Find the last version of the molecule by latest tag preferably
      let latest: (Molecule & {_id: string;_rev: string;})|undefined=undefined;
     
      good_version =  versions.reduce((prev, actual) => {
        const prev_date = new Date(prev.created_at);
        const actual_date = new Date(actual.created_at);
        if (actual.latest) {
          logger.info("[Router:Molecule:get]YOOH");
          latest = actual;
        }
        if (actual_date.getTime() > prev_date.getTime()) {
          // Keep the most recent
          return actual;
        }
        return prev;
      });
      good_version = latest ? latest : good_version;
    }
   
    logger.debug(`[Router:Molecule:get] Sending:\nmolecule:\n${inspect(sanitize(good_version))}\nversions:\n${inspect(versions.map(sanitize))}`)
    res.json({
      molecule: sanitize(good_version),
      versions: versions.map(sanitize),
    });
  })().catch(errorCatcher(res));
});

GetMoleculeRouter.all('/', methodNotAllowed('GET'))

export default GetMoleculeRouter;
