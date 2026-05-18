#
# Simply convert a pdb coordinate section file into gro
gmx editconf -f input/molecule.pdb -o molecule.gro 1>1.editconf.stdout 2>1.editconf.stderr
msg=$(cat 1.editconf.stderr)
[[ ! -s molecule.gro  ]] && { >&2 echo "gro converted molecule missing/empty";>&2 echo $msg;  }
cat molecule.gro;
