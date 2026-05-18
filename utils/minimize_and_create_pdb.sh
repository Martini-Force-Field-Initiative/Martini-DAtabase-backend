#!/bin/bash
if [ ! -z "$SLURM_SUBMIT_DIR" ]
then
    cd $SLURM_SUBMIT_DIR
fi

if [ ! -z "$venv" ]
then
    source $venv
fi


function gmx_fatal_to_stderr {
    msg=$(awk ' BEGIN {b=0} /Fatal error/ {b=1}  /For more information and tips for/ {b=0} (b==1) {print}' $1)
    echo "MESSAGE IS $msg"
    if [[ ! -z "$msg" ]]
    then
        >&2 echo $msg
        >&2 echo from $1
        return 1
    fi
    return 0
}

gro="input/file.gro"
top="input/file.top"
em_mdp="input/em.mdp"

output_conect="output-conect.pdb"
output_conect_temp="outputtemp.pdb"

# Requires: pdb in argument $1, filled top in argument $2, in the right folder
# Requires: a .mdp file in $3

echo ">>$gro $top  <<"

#ajouter input em.mdp, water.gro et solvent

#mv input/em.mdp input/martini_force_field.itp .
echo "[Running] gmx grompp -p $top -c $gro -f $em_mdp -o em.tpr -po em.mdout.mdp -maxwarn 100"
gmx grompp -p $top -c $gro -f $em_mdp -o em.tpr -po em.mdout.mdp -maxwarn 100 > 1.minimization.stdout 2> 1.minimization.stderr
gmx_fatal_to_stderr 1.minimization.stderr || return
#### IF ERROR NEED TO RAISE AN ISSUE ABOUT THE BOX LENGHT
echo "[Running] gmx mdrun -deffnm em -v"
gmx mdrun -deffnm em -v > 2.runminimization.stdout 2> 2.runminimization.stderr
gmx_fatal_to_stderr 2.runminimization.stderr || return
gro_box=$gro

#Center the molecule
echo "[Running] gmx trjconv -f em.gro -s em.tpr -pbc mol -conect -center -o $output_conect_temp"
echo "1" "0" | gmx trjconv -f em.gro -s em.tpr -pbc mol -conect -center -o "$output_conect_temp" > 3.center.stdout 2> 3.center.stderr
gmx_fatal_to_stderr 3.center.stderr || return

echo "[Running] gmx grompp -f $em_mdp -c $output_conect_temp -p file.top  -o pdb.tpr -maxwarn 1"
gmx grompp -f $em_mdp -c $output_conect_temp -p $top  -o pdb.tpr -maxwarn 1 > 4.make_ndx.stdout 2> 4.make_ndx.stderr
gmx_fatal_to_stderr 4.make_ndx.stderr || return

echo "[Running] gmx editconf -f pdb.tpr -conect  -o $output_conect"
gmx editconf -f pdb.tpr -conect  -o "$output_conect" > 5.editconf.stdout 2> 5.editconf.stderr
gmx_fatal_to_stderr 5.editconf.stderr || return