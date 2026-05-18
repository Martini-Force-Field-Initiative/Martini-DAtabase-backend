import cliProgress  from 'cli-progress';
import { basename } from 'path';
import { CliSubcommand } from "../subcommandsTemplate";
import logger, {muteConsoleLogs, cliLogger} from '../../logger';
import { inspect } from "util";
import { MoleculeLoader } from "../../MoleculeLoaderFS";
import { CONNECTED_USER_CLI } from "../user_cli";
import { VersionDatum } from "../../MoleculeLoaderFS/types";

export default new class Loader extends CliSubcommand {
    constructor() {
        super();
        this.command("add", "Parse zip files (glob pattern support) OR folder architecture (single root folder) of model bundles",
        async(folderWitZips:string):Promise<string> => {
            let errors:any = await MoleculeLoader.add(folderWitZips);
     
            if(!errors)
                logger.debug("No parsing errors reported");
            else
                logger.error(`${errors.length} parsing errors reported:\n${inspect(errors, {depth:5})}`);
                return '';
        });
        this.command("commit", "Register parsed model bundles for database insertion (requires admin auth)",
            ()=> {
                if (!CONNECTED_USER_CLI) 
                return 'Please connect before using this command by using user connect';
                
                if (CONNECTED_USER_CLI.role != 'admin')
                return 'You must be admin to commit molecules to the database';
                
                MoleculeLoader.connect(CONNECTED_USER_CLI.id, CONNECTED_USER_CLI.role);
                MoleculeLoader.commit();
                return '';            
        });
       
        this.command("push", "insert registred models into database (requires admin auth)",
          async (rest)=> {
            if (!CONNECTED_USER_CLI) 
                return 'Please connect before using this command by using user connect';
        
            if (CONNECTED_USER_CLI.role != 'admin')
                return 'You must be admin to push molecules to the database';
            MoleculeLoader.connect(CONNECTED_USER_CLI.id, CONNECTED_USER_CLI.role);

            let start = 0, end = MoleculeLoader.length();

            if(rest) {
              rest = rest.trim();
              const match  = rest.match(/(\d+)\D+(\d+)/);
              if(!match)
                return 'Invalid range format, expecting "push <start> <end>"';
              start = parseInt(match[1]);
              end = parseInt(match[2]);
              if(end - start <= 0)
                return 'start and end must be increasing numbers';
            }
            // We shut down stdout logger
            muteConsoleLogs();
           //const barProcessing = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
           //barProcessing.start(MoleculeLoader.length(), 0);

            const multibar = new cliProgress.MultiBar( {
              clearOnComplete: false,
              hideCursor: true,
           //   format: ' {type} | {bar} | {value}/{total}',
              format: (options, params, payload)=> {
                //@ts-ignore
                const rank:number= options.terminal.dy;

                if (!options.barsize || options.barIncompleteString == undefined|| options.barCompleteString == undefined) throw ("This should not happen");
                const completeSize = Math.round(params.progress*options.barsize);
                 
                const incompleteSize = options.barsize-completeSize;
              
                // generate bar string by stripping the pre-rendered strings
                const bar = options.barCompleteString.substr(0, completeSize) +
                        options.barGlue +
                        options.barIncompleteString.substr(0, incompleteSize);
                //const bar = options?.barCompleteString.substr(0, Math.round(params.progress*options.barsize));
                return  `${ rank == 0 ? '\u001b[32m Progress      ' : '\u001B[31m Error(s) Count'} | ${bar} | ${payload.filename ?? 'N/A'} | ${params.value}/${end - start}`;
              }
            }, cliProgress.Presets.shades_grey);
            
          // add bars
            const barProcessing = multibar.create(end - start, 0, {type: 'Processing    '});
            const barErrors     = multibar.create(end - start, 0, {type: 'Error(s) Count'});
          
          // stop all bars
          
            await MoleculeLoader.push( start, end,
              (v:VersionDatum)=>{                 
                barProcessing.increment({filename : basename(v?.itp?.originalname)});
              }, 
              (v:VersionDatum)=>{ 
                  barErrors.increment({filename : basename(v?.itp?.originalname)});
                }
            );
            //barProcessing.stop();
            multibar.stop();
            const cliStringStatus = MoleculeLoader.status(start, end);

            return cliStringStatus;
          });
    }
}
