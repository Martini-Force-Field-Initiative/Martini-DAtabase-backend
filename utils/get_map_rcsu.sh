#!/bin/bash

PDB="input/input.pdb"
echo run contact_map $PDB redirected to $OUTPUT
contact_map $PDB > $OUTPUT

