import { MartinizeSettings } from '../../Builders/Martinizer';
import { basename, resolve as resolvePath } from 'path';
import { anyCoorAsTypeAndStream } from '../../helpers/gmxUtils';
import{ ClientSettings } from '../../controllers/common/martinize';
import { promises as fsp } from 'fs';
import { v4 as uuid } from 'uuid';
import { DatabaseTestManager } from '../testUtils';

const PDB_MARTINIZE_DEMO = "./data_submit/martinize/1p4t.pdb";

export class MartinizerTestHelpers {
    static get createTopFilePrevious() {
        return `${this.createTopFileGenuine}\n[ system ]\nDAPA\n\n[ molecules ]\nDAPA     1\n\n`;
    }
    static get createTopFileGenuine() {
        let s = "#include \"martini_v3.0.0.itp\"\n#include \"martini_v3.0.0_ions_v1.itp\"\n";
        s    += "#include \"martini_v3.0.0_solvents_v1.itp\"\n";
        s    += "#include \"DAPA.itp\"\n";
        return s;
    }
    static async genMartinizeSettingsBasic():Promise<Partial<MartinizeSettings>> {
        const srcPdbPath = resolvePath(__dirname +'/' + PDB_MARTINIZE_DEMO)
        const [_, inputStream] = await anyCoorAsTypeAndStream(srcPdbPath); //
        return {
            input: inputStream,
            ff: 'martini3001',
            position: 'backbone',
            cter: 'COOH-ter',
            nter: 'NH2-ter',
            sc_fix: true,
            use_go: true,
            builder_mode: 'go'
        }
    }
    // More sophisticated Martinize usages
    static async genMartinizeSettingsElastic():Promise<Partial<MartinizeSettings>> {
        const srcPdbPath = resolvePath(__dirname +'/' + PDB_MARTINIZE_DEMO);
        const [_, inputStream] = await anyCoorAsTypeAndStream(srcPdbPath);
        return {
            input: inputStream,
           // position: "none",
            ff:"martini3001"
        };
    }
    static async generateInputSocketMartinize(): Promise<[Buffer, ClientSettings, string]> {
        const srcPdbPath = resolvePath(__dirname +'/' + PDB_MARTINIZE_DEMO);
        const fileBuffer = await fsp.readFile(srcPdbPath);
        const settings:ClientSettings = {
            ff: 'martini3001',
            position: 'backbone',
            cter: 'COOH-ter',
            nter: 'NH2-ter',
            sc_fix: 'false',
            cystein_bridge: 'none',
            builder_mode: 'classic',
            send_mail: 'false',
            user_id : DatabaseTestManager.admin_id,//'1030379594262172909',
            pdb_name: basename(PDB_MARTINIZE_DEMO)
          }
        const runID = uuid();
        return [fileBuffer, settings, runID];    
    };
}
