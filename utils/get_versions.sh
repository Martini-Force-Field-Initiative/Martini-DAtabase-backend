#
# A single script to perform service version display
# It is supposed to be used only once, at webserver startup
#
#
#
if [ $SERVICE == "martinize" ]
    then
    V=$(martinize2 --version | sed -E 's/martinize with vermouth ([0-9]+\.[0-9]+\.[0-9]+)/\1/')
    echo "{ \"martinize2\" : \"$V\" }"
    elif [ $SERVICE == "polyply" ]
    then
        V_POLY=$(polyply --version | grep -v INFO | sed -E 's/polyply version //')
        echo -e "import vermouth\nprint(vermouth.__version__)"  > version_display.py
        V_VERM=$(python ./version_display.py)
        echo "{ \"polyply\" : \"$V_POLY\",  \"vermouth\" : \"$V_VERM\" }"
fi
