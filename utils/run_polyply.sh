
GROOUT="out.gro"
LOG_PREFIX="polyply_itp_step"

echo "run_polyply: $action action"> polyply_cmd.log
if [ $action == "itp" ]
    then

    # Follwoing action should be done on controller side
    #if [ -s input/monfichier.itp ]; then

    #    cat input/monfichier.itp |
    #    awk -v RS=";NEWITP" '{ print $0 > "file_itp" NR"custom.itp" }'

    #    for i in $(grep -l 'connexion rule' *itp)

    #    do
    #        mv $i $i".ff"
    #    done

        #In case of someone add  an empty file or something
    #    find *itp -type f -size -5c -delete -print > find_clean_itp.log
    #    cmd="polyply gen_params $genparam_f_flag -lib $ff -o $ITPOUT -seqf input/polymer.json -name $name";
    #    echo "run_polyply: $cmd" >> polyply_cmd.log
    #    polyply gen_params $genparam_f_flag -lib $ff -o $ITPOUT -seqf input/polymer.json -name $name > $LOG_PREFIX.out 2> $LOG_PREFIX.err

    #else
        cmd="polyply gen_params $genparam_f_flag -lib $ff -o $ITPOUT -seqf input/polymer.json -name $name"
        echo "run_polyply: $cmd" > polyply_cmd.log
        polyply gen_params $genparam_f_flag -lib $ff -o $ITPOUT -seqf input/polymer.json -name $name > $LOG_PREFIX.out 2> $LOG_PREFIX.err
    #fi

    if grep 'OSError' $LOG_PREFIX.err > /dev/null;
        then
        >&2 grep 'OSError' $LOG_PREFIX.err
    fi
    [[ -s $ITPOUT ]] && cat $ITPOUT;
    if grep 'Missing a link' $LOG_PREFIX.err > /dev/null;
        then  grep 'Missing a link' $LOG_PREFIX.err > missing_links.warn
    fi
fi

if [ $action == "gro" ]
    then
    LOG_PREFIX="polyply_gro_step"
    #cat input/polymere.itp > polymere.itp
    #cat input/system.top > system.top
    #cat input/
    #mv input/* .
    if [ ! -z "$USR_GRO" ]; then
        cmd="polyply gen_coords -p input/system.top -c input/$USR_GRO -o $GROOUT -name $name -box $box $box $box"
        polyply gen_coords -p input/system.top -c input/$USR_GRO -o $GROOUT -name $name -box $box $box $box > $LOG_PREFIX.out 2> $LOG_PREFIX.err
    else
        cmd="polyply gen_coords -p input/system.top -o $GROOUT -name $name -box $box $box $box"
        polyply gen_coords -p input/system.top -o $GROOUT -name $name -box $box $box $box > $LOG_PREFIX.out 2> $LOG_PREFIX.err
    fi


    echo "run_polyply: $cmd" >> polyply_cmd.log
    [[ -s $GROOUT ]] && cat $GROOUT
    [[ -s $GROOUT ]] || >&2 echo "Empty GRO file"
fi

# Bubble up error lines to job manager (aka echo on stderr)
# When dealing w/ gro production some error can be salvage but we need the full polyply stderr
if [ -f $LOG_PREFIX.err ];then
   # if [ $action == "itp" ]
   #     then
        grep 'ERROR' $LOG_PREFIX.err && >&2 grep 'ERROR' $LOG_PREFIX.err
        #grep 'Missing a link' $LOG_PREFIX.err && >&2 grep 'Missing a link' $LOG_PREFIX.err
   # else
   #     >&2 cat $LOG_PREFIX.err
   # fi
fi
