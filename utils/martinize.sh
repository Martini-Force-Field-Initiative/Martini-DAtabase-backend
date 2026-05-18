#!/bin/bash
# GL
# trying as it is w/ vermouth rc

martinize2_path="martinize2"
input="input/input.pdb"

cmd_line="$martinize2_path -f $input $COMMAND_LINE -maxwarn 9999"

echo $cmd_line
martinize2 --version

if $cmd_line 2> martinize_redirect.stderr;
    then
    echo "Safe end of martinize2 call, renaming eventual molecule.itp to molecule_0.itp"
    if [[ -s molecule.itp ]]
        then
            echo "molecule.itp detected reruning martinize2 w/ suffix '-name molecule_0'"
            echo "molecule.itp detected reruning martinize2 w/ suffix '-name molecule_0'" >> martinize_redirect.stderr
            new_cmd_line="$cmd_line -name molecule_0"
            echo $new_cmd_line
            $new_cmd_line 2> martinize_redirect.stderr
            rm molecule.itp # Delete previous run itp
    fi

    chmod g+r *.itp
    chmod g+r *.pdb
    chmod g+r *.top
else
    >&2 echo "The following fatal error occured during your martinize2 call: "
    grep -v INFO  martinize_redirect.stderr | grep -v WARNING 1>&2
fi
{ grep "WARNING" martinize_redirect.stderr > $MARTINIZE_WARN || true; }
