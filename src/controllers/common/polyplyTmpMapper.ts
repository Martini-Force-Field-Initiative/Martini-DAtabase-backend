import { ArrayValues } from "../../helpers/simple";
import logger from "../../logger";

/*
    Enrich description on polyply librairy of molecules
*/
const MolTypeGroups = ["Amino acids", "Nucleotides", "Others"] as const;
type MolTypeGroup = ArrayValues<typeof MolTypeGroups>;
export const checkMolTypeGroup = (o: string): o is MolTypeGroup => {
  return MolTypeGroups.includes(o as any);
};

type ThumbnailUrl = string;
type alias = string;
type MolDescriptor = [string, ThumbnailUrl, MolTypeGroup];
type MolInfos = [string, ThumbnailUrl, alias];
export type MolTypeCatalog = Record<MolTypeGroup, MolInfos[]>;

export default class MolTypeConverter {
  private static rosetta: Record<alias, MolDescriptor> = {
    PP: [
      "polypropylene",
      "/api/polymer_generator/thumbnails/Polypropylene.png",
      "Others",
    ],
    PDADMA: [
      "polydiallyldimethylammonium chloride",
      "/api/polymer_generator/thumbnails/PDADMA.png",
      "Others",
    ],
    PSS: [
      "polystyrene sulfonate",
      "/api/polymer_generator/thumbnails/Polystyrolsulfonat.png",
      "Others",
    ],
    P3HT: [
      "poly(3-hexyl-thiophene)",
      "/api/polymer_generator/thumbnails/P3HT.png",
      "Others",
    ],
    PE: [
      "polyethylene",
      "/api/polymer_generator/thumbnails/Polyethylene.png",
      "Others",
    ],
    DT3: [
      "2-deoxythymidine 5-monophosphate (3'-end)",
      "/api/polymer_generator/thumbnails/DTMP.png",
      "Nucleotides",
    ],
    DT: [
      "2-deoxythymidine 5-monophosphate",
      "/api/polymer_generator/thumbnails/DTMP.png",
      "Nucleotides",
    ],
    DT5: [
      "2-deoxythymidine 5-monophosphate (5'-end)",
      "/api/polymer_generator/thumbnails/DTMP.png",
      "Nucleotides",
    ],
    DC3: [
      "2'-deoxycytosine 5'-monophosphate (3'-end)",
      "/api/polymer_generator/thumbnails/DCMP.png",
      "Nucleotides",
    ],
    DG: [
      "2\′-deoxyguanosine 5\′-monophosphate",
      "/api/polymer_generator/thumbnails/DGMP.png",
      "Nucleotides",
    ],
    DC: [
      "2'-deoxycytosine 5'-monophosphate ",
      "/api/polymer_generator/thumbnails/DCMP.png",
      "Nucleotides",
    ],
    DA: [
      "2\′-deoxyadenosine  5\′-monophosphate",
      "/api/polymer_generator/thumbnails/DAMP.png",
      "Nucleotides",
    ],
    DC5: [
      "2'-deoxycytosine 5'-monophosphate (5'-end)",
      "/api/polymer_generator/thumbnails/DCMP.png",
      "Nucleotides",
    ],
    DA5: [
      "2\′-deoxyadenosine  5\′-monophosphate (5'-end)",
      "/api/polymer_generator/thumbnails/DAMP.png",
      "Nucleotides",
    ],
    DA3: [
      "2\′-deoxyadenosine  5\′-monophosphate (3'-end)",
      "/api/polymer_generator/thumbnails/DAMP.png",
      "Nucleotides",
    ],
    DG5: [
      "2\′-deoxyguanosine 5\′-monophosphate (5'-end)",
      "/api/polymer_generator/thumbnails/DGMP.png",
      "Nucleotides",
    ],
    DG3: [
      "2\′-deoxyguanosine 5\′-monophosphate (3'-end)",
      "/api/polymer_generator/thumbnails/DGMP.png",
      "Nucleotides",
    ],
    PS: [
      "polystyrene",
      "/api/polymer_generator/thumbnails/Polystyrene.png",
      "Others",
    ],
    OHter: [
      "polyethylene glycol terminal",
      "/api/polymer_generator/thumbnails/PEG.png",
      "Others",
    ],
    PEO: [
      "polyethylene glycol",
      "/api/polymer_generator/thumbnails/PEG.png",
      "Others",
    ],
    PPEinit: [
      "polyphenylene ether terminal",
      "/api/polymer_generator/thumbnails/Polyphenylene.png",
      "Others",
    ],
    PPE: [
      "polyphenylene ether",
      "/api/polymer_generator/thumbnails/Polyphenylene.png",
      "Others",
    ],
    PPEter: [
      "polyphenylene ether terminal",
      "/api/polymer_generator/thumbnails/Polyphenylene.png",
      "Others",
    ],
    PMMA: [
      "poly(methyl methacrylate) ",
      "/api/polymer_generator/thumbnails/Methyl-methacrylate.png",
      "Others",
    ],
    PDMS: [
      "polydimethylsiloxane",
      "/api/polymer_generator/thumbnails/PDMS.png",
      "Others",
    ],
    PDMSter: [
      "polydimethylsiloxane terminal",
      "/api/polymer_generator/thumbnails/PDMS.png",
      "Others",
    ],
    PTMA: [
      "Poly(TEMPO methacrylate)",
      "/api/polymer_generator/thumbnails/PTMA.png",
      "Others",
    ],
    PVA: [
      "polyvinyl alcohol",
      "/api/polymer_generator/thumbnails/PVA.png",
      "Others",
    ],
    DEX: ["dextran", "/api/polymer_generator/thumbnails/Dextran.png", "Others"],
    GLY: [
      "glycine",
      "/api/polymer_generator/thumbnails/Glycine.png",
      "Amino acids",
    ],
    ALA: [
      "alanine",
      "/api/polymer_generator/thumbnails/Alanine.png",
      "Amino acids",
    ],
    CYS: [
      "cysteine",
      "/api/polymer_generator/thumbnails/Cysteine.png",
      "Amino acids",
    ],
    VAL: [
      "valine",
      "/api/polymer_generator/thumbnails/Valine.png",
      "Amino acids",
    ],
    LEU: [
      "leucine",
      "/api/polymer_generator/thumbnails/Leucine.png",
      "Amino acids",
    ],
    ILE: [
      "isoleucine",
      "/api/polymer_generator/thumbnails/Isoleucine.png",
      "Amino acids",
    ],
    MET: [
      "methionine",
      "/api/polymer_generator/thumbnails/Methionine.png",
      "Amino acids",
    ],
    PRO: [
      "proline",
      "/api/polymer_generator/thumbnails/Proline.png",
      "Amino acids",
    ],
    HYP: [
      "hydroxyproline",
      "/api/polymer_generator/thumbnails/Hydroxyproline.png",
      "Amino acids",
    ],
    ASN: [
      "asparagine",
      "/api/polymer_generator/thumbnails/Asparagine.png",
      "Amino acids",
    ],
    GLN: [
      "glutamine",
      "/api/polymer_generator/thumbnails/Glutamine.png",
      "Amino acids",
    ],
    ASP: [
      "aspartate",
      "/api/polymer_generator/thumbnails/Aspartate.png",
      "Amino acids",
    ],
    GLU: [
      "glutamate",
      "/api/polymer_generator/thumbnails/Glutamate.png",
      "Amino acids",
    ],
    THR: [
      "threonine",
      "/api/polymer_generator/thumbnails/Threonine.png",
      "Amino acids",
    ],
    SER: [
      "serine",
      "/api/polymer_generator/thumbnails/Serine.png",
      "Amino acids",
    ],
    LYS: [
      "lysine",
      "/api/polymer_generator/thumbnails/Lysine.png",
      "Amino acids",
    ],
    ARG: [
      "arginine",
      "/api/polymer_generator/thumbnails/Arginine.png",
      "Amino acids",
    ],
    HIS: [
      "histidine",
      "/api/polymer_generator/thumbnails/Histidine.png",
      "Amino acids",
    ],
    HIH: [
      "histidine (protonated)",
      "/api/polymer_generator/thumbnails/Histidine.png",
      "Amino acids",
    ],
    PHE: [
      "phenylalanine",
      "/api/polymer_generator/thumbnails/Phenylalanine.png",
      "Amino acids",
    ],
    TYR: [
      "tyrosine",
      "/api/polymer_generator/thumbnails/Tyrosine.png",
      "Amino acids",
    ],
    TRP: [
      "tryptophan",
      "/api/polymer_generator/thumbnails/Tryptophan.png",
      "Amino acids",
    ],
    PMA: [
      "poly(methyl acrylate) ",
      "/api/polymer_generator/thumbnails/PMA.png",
      "Others",
    ],
    CEL: [
      "cellulose",
      "/api/polymer_generator/thumbnails/Cellulose.png",
      "Others",
    ],
    // Updated on october 2025 TO COMPLETE W/ Fabian info on common names
    "12BD": [
      "poly 1,2 butadiene",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    "2VP": [
      "poly vinyl pyridine",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    "4VP": [
      "poly vinyl pyridine",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    AAC: [
      "poly acrylic acid",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    AAI: [
      "poly acrylic acid charged",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    AAMD: [
      "poly acrylamide",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    ALI: [
      "poly allyl amine charged",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    ALL: [
      "poly allyl amine",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    CH3ter: ["CH3ter", "/api/polymer_generator/thumbnails/blank.png", "Others"],
    EA1: [
      "poly ethyl acrylate",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    EO: ["Ask Fabian", "/api/polymer_generator/thumbnails/blank.png", "Others"],
    HEA: [
      "poly hydroxy ethyl acrylate",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    HPA: [
      "poly hydroxy propyl acrylate",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    MAC: [
      "poly methyl acrylate",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    NIPA: [
      "poly n-isopropyl amide",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    PiB: ["PiB", "/api/polymer_generator/thumbnails/blank.png", "Others"],
    SBU: [
      "Ask Fabian",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    STYR: [
      "Polystyrene",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
    nBA: [
      "poly butyl acrylate",
      "/api/polymer_generator/thumbnails/blank.png",
      "Others",
    ],
  };
  static translate(from: string): MolDescriptor {
    if (from in MolTypeConverter.rosetta) return MolTypeConverter.rosetta[from];

    throw new Error(
      `[MolTypeConverter] "${from}" is not a valid molecule symbol or name`,
    );
  }
  /**
   * index the content of list of string into a MolTypeCatalog
   *  @exemple
   *  MolTypeConverter.createCatalogue(['ALA', 'VAL', 'CEL'])
   *  returns
   *  { "Amino acids" : [ [ 'Alanine', "/api/polymer_generator/thumbnails/alanine.svg", "ALA"],
   *                      [ 'Valine',  "/api/polymer_generator/thumbnails/valine.svg", "VAL"]
   *                    ],
   *    "Others"      : [ 'cellulose', "/api/polymer_generator/thumbnails/cellulose.svg", "CEL"]
   * }
   */
  static createCatalogue(infos: string[]): MolTypeCatalog {
    const d: Partial<MolTypeCatalog> = {};
    infos.forEach((s) => {
      const [name, url, category] = MolTypeConverter.translate(s);
      const molInfo: MolInfos = [name, url, s];
      if (!(category in d)) d[category] = [molInfo];
      else d[category]?.push(molInfo);
    });

    return d as MolTypeCatalog;
  }
}

/*    const to = Object.keys(this.rosetta).find( (key) => this.rosetta[key] === from);
        if(!to)
            throw new Error(`"${from}" is not a valid molecule symbol or name`)
        return to;
    }*/

/*
{ 'PP',    'PDADMA', 'PSS',
'P3HT',  'PE',     'DT3',
'DT',    'DT5',    'DC3',
'DG',    'DC',     'DA',
'DC5',   'DA5',    'DA3',
'DG5',   'DG3',    'PS',
'OHter', 'PEO'
],
martini3: [
'PE',   'PPEinit', 'PPE',     'PPEter',
'PMMA', 'PDMS',    'PDMSter', 'PTMA',
'PVA',  'DEX',     'P3HT',    'GLY',
'ALA',  'CYS',     'VAL',     'LEU',
'ILE',  'MET',     'PRO',     'HYP',
'ASN',  'GLN',     'ASP',     'GLU',
'THR',  'SER',     'LYS',     'ARG',
'HIS',  'HIH',     'PHE',     'TYR',
'TRP',  'PSS',     'PEO',     'OHter',
'PS',   'PMA',     'CEL',
*/
