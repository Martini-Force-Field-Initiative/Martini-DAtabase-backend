import { Router } from "express";
import { inspect } from "util";
// Adapted from
// https://fr.wikipedia.org/wiki/BibTeX
import logger from "../../../logger";

import LibraryStore from "../../../Stores/Bibliography";

const CitationRouter = Router();
CitationRouter.get("/scaffold", async (_, res) => {
  const citationStore = LibraryStore.getStore();
  const cites = citationStore.scaffold();
  logger.info("CitationRouter");
  logger.info(inspect(cites));
  res.json(cites);
});
CitationRouter.get("/refs", async (req, res) => {
  const citationStore = LibraryStore.getStore();
  logger.info(inspect(req.query));
  /*
  const cites = citationStore.scaffold();
  logger.info("CitationRouter");
  logger.info(inspect(cites));
  res.json(cites);
  */
  const refs = citationStore.get_references(
    req.query.format as "bibtex" | "ris",
    ...(req.query.aliases as string).split(","),
  );
  console.log(refs);
  res.setHeader("Content-Type", "text/plain"); // Set the appropriate content type
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=mad_bibliography.${req.query.format === "bibtex" ? "bib" : "ris"}`,
  ); // Trigger download

  res.send(refs);
});
export default CitationRouter;
