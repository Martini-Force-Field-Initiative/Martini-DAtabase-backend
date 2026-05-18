
mad-boxer -i input/coord.gro -o wrapped.gro >wrapped.log 2>&1
[[ -s wrapped.gro ]] || { >&2 echo "Empty GRO file"; exit 1; } # Exit my break stuff