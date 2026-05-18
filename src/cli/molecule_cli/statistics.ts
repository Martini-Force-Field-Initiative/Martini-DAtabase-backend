import { Database } from "../../Entities/CouchHelper";
import { CliSubcommand } from "../subcommandsTemplate";
import { GoTerm } from "../../types";
import logger from '../../logger';
import { tablify } from "../views";

export default new class Statistics extends CliSubcommand {
    constructor() {
        super();
        this.command('count', 'Count registred and stashed molecules', 
        async () => {
            const mols = await Database.molecule.all();
            const stashed = await Database.stashed.all();
            const counts = [
                { Type: 'registred', Number: mols.length},
                { Type: 'stashed', Number: stashed.length}              
            ];
            
            return tablify(counts);
        })
        this.command("llist", "list registered molecules with informations",
        async() => {           
            const mols = await Database.molecule.all();
            const stashed = await Database.stashed.all();

            if (!mols.length && !stashed.length)
                return `This server does not contain any molecule.`;

            const normal = `There are ${mols.length} available molecules:\n- ${ 
                mols.map((m) => `id: ${m._id} , name: ${m.name} , version: ${m.version} , type: ${m.category as GoTerm[]} , file: ${m.files}`
                //`id: ${m._id} , name: ${m.name}, version: ${m.version}, type: ${m.category as GoTerm[]}`
                ).join('\n- ')}`;
            const stash = `There are ${stashed.length} stashed molecules:\n- ${ stashed.map((m) => {
                let cat = m.category;
                return `id: ${m._id} , name: ${m.name} , version: ${m.version} , type: ${cat} , file:${m.files}`;
                }).join('\n- ')}`;
            
            logger.info (mols.length ? normal : "") + (mols.length && stashed.length ? "\n" : "") + (stashed.length ? stash : "");
            return '';
        });

        this.command('list', 'List registered molecules', 
        async () => {
            const mols = await Database.molecule.all();
            const stashed = await Database.stashed.all();
          
            if (!mols.length && !stashed.length) {
              return `This server does not contain any molecule.`;
            }
          
            const normal = `Available molecules are \n- ${mols.map(m => m._id).join('\n- ')}`;
            const stash = `Available stashed molecules are \n- ${stashed.map(m => m._id).join('\n- ')}`;
          
            return (mols.length ? normal : "") + (mols.length && stashed.length ? "\n" : "") + (stashed.length ? stash : "");
        });
    } 
}