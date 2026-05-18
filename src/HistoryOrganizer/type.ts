import { ClientSettingsMartinize, AvailableJobType } from "../controllers/dto/molecule.dto";
import { FilePathOrTupleStream } from '../helpers/inputs';
import { PolyplyJobSettings, MoleculeBuilderJobSettings } from '../Entities/entities/job';

export interface HistoryBundleFS {
    all_atom?      : FilePathOrTupleStream,
    coarse_grained: FilePathOrTupleStream,
    itp_files     : FilePathOrTupleStream[][],
    top_file      : FilePathOrTupleStream,
    warnings?      : FilePathOrTupleStream,
    gro           : FilePathOrTupleStream
};

export type HistorySaveSpecs = {
    jobId:string,
    userId:string,
    files:HistoryBundleFS,
    radius?: { [atom_name: string]: number; },
    type:AvailableJobType,
    name:string
    settings:PolyplyJobSettings|MoleculeBuilderJobSettings|ClientSettingsMartinize
} 



export function isMoleculeBuilderHistoryBundleFS(o:HistoryBundleFS) {
    return o.all_atom !== undefined;
}