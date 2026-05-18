import { Router } from 'express';
import { errorCatcher } from '../../../helpers/simple';
import { Database } from '../../../Entities/CouchHelper';
import { MangoQuery } from 'nano';
import { MoleculeLoader } from "../../../MoleculeLoaderFS";
//import { AvailableForceFields, FORCE_FIELDS } from "../../../helpers/martiniVersions";
import ForceFieldStore, { AvailableForceField } from '../../../Stores/ForceFieldStore';
import logger from '../../../logger';
// Get a pdb from a file ID
const GetInformationAPI = Router();

async function getInformation(field: string, value: string) {
  const selectruc: MangoQuery = { selector: { [field]: value } }
  return await Database.molecule.find(selectruc)
    .then(async (molcouch) => {
      if (molcouch.length === 0)
        return { error: "No molecule found for this forcefield." }
         
      let response: any = {};
      for (let i in Object.keys(molcouch)) {
        const alias = molcouch[i].alias;
        if (Object.keys(response).includes(alias)) {
          response[alias]["version"].push(molcouch[i].version);
        }
        else {
          response[alias] = {
            "name": molcouch[i].name,
            "citation": molcouch[i].citation,
            "forcefield": molcouch[i].force_field,
            "category": molcouch[i].category,
            "version": [molcouch[i].version],
          };
        }
      }
      let response2: any = {};
      let c = 0;
      for (let i of Object.keys(response)) {
        response2[c] = {
          "alias": i,
          "name": response[i].name,
          "citation": response[i].citation,
          "forcefield": response[i].forcefield,
          "category":await MoleculeLoader.decodeCategory(response[i].category[0]),
          "version": response[i].version
        };
        c++;
      }
      return response2;
    });
}

//If format isnt provided give the last update of this model 
GetInformationAPI.get('/:field', (req, res) => {
  (async () => {
    const ffStore = ForceFieldStore.getStore();
    logger.debug("[Router:GetInformationAPI]");
    const field = req.params.field as AvailableForceField
    if (ffStore.isAvailableForceField(field)) {
      logger.debug(field);
      const response = await getInformation("force_field", field);
      res.send(response);
    }
    else {
      res.status(400).send({ error: "Invalid field" });
    }

    // else #CHECK if it's a ctagory field {
    //   const response = await getInformation("category", field);
    //   res.send(response);
    // }

  })().catch(errorCatcher(res));
});

export default GetInformationAPI;