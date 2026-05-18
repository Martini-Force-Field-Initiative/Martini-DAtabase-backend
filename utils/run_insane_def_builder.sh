
mkdir work_dir
cmd="mad-ibuild input/$mol_name.itp $mol_name.json --wdir ./work_dir/ --ff input/"
echo "=>$cmd" > cmd.log

$cmd > mad-ibuild.log 2> mad-ibuild.err

[[ -s $mol_name.json ]] || { >&2 echo "$mol_name.json missing or empy"; exit 1; }

cat $mol_name.json
