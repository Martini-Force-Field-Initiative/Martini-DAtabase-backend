import { BIBLIOGRAPHY_FOLDER } from "../constants";
import { inspect } from "util";
import logger from "../logger";
import { isLiteralObject } from "../helpers/simple";
import fs, { promises as FsPromise, promises } from "fs";
class CitationLoadError extends Error {}

const ItemTypes = [
  "article",
  "book",
  "booklet",
  "conference",
  "inbook",
  "incollecion",
  "inproceedings",
  "manual",
  "masterthesis",
  "misc",
  "phdthesis",
  "proceedings",
  "techreport",
  "unpublished",
];
export type ItemType = (typeof ItemTypes)[number];
const Sections = [
  "Tools",
  "Force field",
  "Force Field Extension",
  "Optional protein Features",
];
export type Section = (typeof Sections)[number];
interface Item {
  address?: string; //l'adresse de l'éditeur ;
  abstract?: string; //résumé de l'article ;
  annote?: string; //une annotation ;
  author?: string; //nom(s) puis prénom(s) des auteurs séparés par and. Exemple : author = {DO, John and DUPOND, Marc}
  booktitle?: string; //le titre du livre ;
  chapter?: string; //le numéro de chapitre ;
  crossref?: string; //la clé d'une référence croisée ;
  doi?: string;
  edition?: string; //l'édition du livre ;
  editor?: string; //le nom de l'éditeur scientifique ;
  eprint?: string; //la spécification d'une publication électronique ;
  howpublished?: string; // comment il a été publié, si ce n'est pas avec une méthode standard ;
  issn?: string;
  institution?: string; // l'institution impliquée dans la publication (pas forcément l'éditeur) ;
  journal?: string; //la revue ou le magazine dans lequel le travail a été publié ;
  keywords?: string;
  key?: string; // un champ caché utilisé pour spécifier ou remplacer l'ordre alphabétique des entrées (quand "author et "editor" ne sont pas présents) ;
  month?: string; //le mois de la création ou de la publication ;
  note?: string; //informations diverses ;
  number?: string; //le numéro du journal ou du magazine ;
  organization?: string; //le sponsor d'une conférence ;
  pages?: string; //les numéros de pages, séparés par des virgules ou sous forme d'intervalles ;
  publisher?: string; //le nom de la maison d'édition ;
  school?: string; //l'école dans laquelle la thèse a été écrite ;
  series?: string; //la collection dans laquelle le livre a été publié ;
  title?: string; //le titre du document ;
  type: ItemType;
  url?: string; //l'adresse URL ;
  volume?: string; //le volume, dans le cas où il y a plusieurs volumes ;
  year?: string; //l'année de publication (ou de création s'il n'a pas été publié).
}

const ItemKeys = [
  "address",
  "abstract",
  "annote",
  "author",
  "booktitle",
  "chapter",
  "crossref",
  "doi",
  "edition",
  "editor",
  "eprint",
  "howpublished",
  "institution",
  "issn",
  "journal",
  "key",
  "keywords",
  "month",
  "note",
  "number",
  "organization",
  "pages",
  "publisher",
  "school",
  "series",
  "title",
  "type",
  "url",
  "volume",
  "year",
];

interface ItemView {
  alias: string;
  section: string;
  content: Record<string, string>;
}

interface ItemAtlas {
  title: Section;
  items: ItemView[];
}

class Node {
  alias: string;
  section: Section;
  content: Item;
  bibtex: string;
  ris: string;
  constructor(data: { [k: string]: any }) {
    // Check alias, section  key / values
    if (!data.hasOwnProperty("alias"))
      throw new CitationLoadError(`'alias' key not found in ${inspect(data)}`);
    if (!data.hasOwnProperty("section"))
      throw new CitationLoadError(
        `'section' key not found in ${inspect(data)}`,
      );
    if (!data.hasOwnProperty("content"))
      throw new CitationLoadError(
        `'content' key not found in ${inspect(data)}`,
      );
    if (!data.hasOwnProperty("as_ris"))
      throw new CitationLoadError(`'as_ris' key not found in ${inspect(data)}`);
    if (!data.hasOwnProperty("as_bib"))
      throw new CitationLoadError(`'as_bib' key not found in ${inspect(data)}`);

    if (!Node.isItem(data.content))
      throw new CitationLoadError(
        `'content' content malformed in ${inspect(data)}`,
      );
    this.alias = data.alias;
    this.section = data.section;
    this.content = data.content;
    try {
      this.ris = fs.readFileSync(
        `${BIBLIOGRAPHY_FOLDER}/${data.as_ris}`,
        "utf8",
      );
      this.bibtex = fs.readFileSync(
        `${BIBLIOGRAPHY_FOLDER}/${data.as_bib}`,
        "utf8",
      );
    } catch (err) {
      console.error("Error reading the file:", err);
      throw new CitationLoadError(`Error reading the file: ${err}`);
    }
  }

  public get plain(): ItemView {
    const plain: {
      alias: string;
      section: string;
      content: Record<string, string>;
    } = {
      alias: this.alias,
      section: this.section,
      content: {},
    };
    for (const [key, value] of Object.entries(this.content)) {
      plain.content[key] = value;
    }
    return plain;
  }

  static isItem(content: unknown): content is Item {
    if (!isLiteralObject(content)) {
      logger.error(`Citation Item is not a literral Obj ${inspect(content)}`);
      return false;
    }
    if (!("type" in content)) {
      logger.error(`'type' key not found in ${inspect(content)}`);
      return false;
    }

    for (const k in content) {
      if (!ItemKeys.includes(k)) {
        logger.error(`'${k}' is not a valid Citation Item property`);
        return false;
      }
    }
    return true;
  }
}

export default class LibraryStore {
  static instance: LibraryStore;

  data: Node[] = [];
  aliases: { [alias: string]: Node } = {};
  register: { [k: Section]: Node[] } = {};
  public static getStore(): LibraryStore {
    if (!LibraryStore.instance) {
      throw new CitationLoadError(`LibraryStore:store not initialized`);
    }
    return LibraryStore.instance;
  }

  public static async setStore(): Promise<void> {
    logger.info("LibraryStore:load from " + BIBLIOGRAPHY_FOLDER);
    let data: {};
    try {
      const file = await FsPromise.readFile(
        `${BIBLIOGRAPHY_FOLDER}/citations.json`,
        "utf-8",
      );
      data = JSON.parse(file);
    } catch (e) {
      logger.error("Unable to get citations.json file.", e);
      throw new CitationLoadError(
        `Unable to get citation definition file \"${e}\"`,
      );
    }
    if (!("references" in data))
      throw new CitationLoadError(
        `Unable to get "references" field from \"${BIBLIOGRAPHY_FOLDER}/citations.json\"`,
      );
    LibraryStore.instance = new LibraryStore(
      data.references as { [k: string]: any }[],
    );
  }

  constructor(references: { [k: string]: any }[]) {
    this.data = references.map((_) => new Node(_));
    console.log(`Successfully loaded ${this.data.length} citations`);
    this.data.forEach((n: Node) => {
      if (!(n.section in this.register)) this.register[n.section] = [];
      this.register[n.section].push(n);
      if (n.alias in this.aliases)
        throw new CitationLoadError(
          `Mutliple definition of citation '${n.alias}'`,
        );
      this.aliases[n.alias] = n;
    });

    // Now attach RIS bibTex Strings
    //
  }

  public scaffold(): ItemAtlas[] {
    const res: ItemAtlas[] = [];

    const results: { data: ItemView[] } = { data: [] };
    for (const [section, nodes] of Object.entries(this.register)) {
      res.push({
        title: section,
        items: nodes.map((n) => n.plain),
      });
    }

    return res;
  }

  public get_references(
    format: "bibtex" | "ris",
    ...aliases: string[]
  ): string {
    logger.info("get_references");
    logger.info(aliases);
    const _ = aliases.reduce((refs, alias, i) => {
      if (!(alias in this.aliases)) {
        logger.error(`citation alias ${alias} not found`);
        return refs;
      }
      return `${refs}${format === "bibtex" ? this.aliases[alias].bibtex : this.aliases[alias].ris}`;
    }, "");
    return _;
  }
}
