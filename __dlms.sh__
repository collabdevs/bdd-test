
jsondoc="{"
while [[ $# > 1 ]]
do
key="$1"

case $key in
    -p|--project_name)
    if [ "$jsondoc" != "{" ]; then 
         jsondoc=$jsondoc","
    fi
    jsondoc=$jsondoc"\"project_name\":\"$2\""
    shift # past argument
    ;;

    -r|--runtime_name)
    if [ "$jsondoc" != "{" ]; then 
         jsondoc=$jsondoc","
    fi
    jsondoc=$jsondoc"\"runtime_name\":\"$2\""
    shift # past argument
    ;;

    -m|--module_name)
    if [ "$jsondoc" != "{" ]; then 
         jsondoc=$jsondoc","
    fi
    jsondoc=$jsondoc"\"module_name\":\"$2\""
    shift # past argument
    ;;

    -b|--build_number)
    if [ "$jsondoc" != "{" ]; then 
         jsondoc=$jsondoc","
    fi
    jsondoc=$jsondoc"\"build_number\":\"$2\""
    shift # past argument
    ;;

    -e|--environment_name)
    if [ "$jsondoc" != "{" ]; then 
         jsondoc=$jsondoc","
    fi
    jsondoc=$jsondoc"\"environment_name\":\"$2\""
    shift # past argument
    ;;

    -l|--lifecycle_stage)
    if [ "$jsondoc" != "{" ]; then 
         jsondoc=$jsondoc","
    fi
    jsondoc=$jsondoc"\"lifecycle_stage\":\"$2\""
    shift # past argument
    ;;

    -u|--url)
    if [ "$jsondoc" != "{" ]; then 
         jsondoc=$jsondoc","
    fi
    jsondoc=$jsondoc"\"url\":[\"$2\"]"
    shift # past argument
    ;;

    -t|--tool_name)
    if [ "$jsondoc" != "{" ]; then 
         jsondoc=$jsondoc","
    fi
    jsondoc=$jsondoc"\"tool_name\":\"$2\""
    shift # past argument
    ;;

    -d|--description)
    if [ "$jsondoc" != "{" ]; then 
         jsondoc=$jsondoc","
    fi
    jsondoc=$jsondoc"\"description\":\"$2\""
    shift # past argument
    ;;

    -cm|--custom_metadata)
    if [ -e "$2" ]; then
        if [ -f "$2" ]; then
            if [ "$jsondoc" != "{" ]; then 
                jsondoc=$jsondoc","
            fi
            cont=`cat "$2"`
            jsondoc=$jsondoc"\"custom_metadata\":$cont"
        fi
    fi
    shift # past argument
    ;;

    -c|--contents)
    if [ -e "$2" ]; then
        if [ -f "$2" ]; then
            if [ "$jsondoc" != "{" ]; then 
                jsondoc=$jsondoc","
            fi
            cont=`cat "$2" | base64 -w 0`
            #jsondoc=$jsondoc"\"contents\":{\"fcontents\":\"$cont\"}"
            jsondoc=$jsondoc"\"contents\":\"$cont\""
        fi
    fi
    shift # past argument
    ;;

    -h|--html_contents)
    if [ -e "$2" ]; then
        if [ -f "$2" ]; then
            if [ "$jsondoc" != "{" ]; then 
                jsondoc=$jsondoc","
            fi
            cont=`cat "$2" | base64 -w 0`
            jsondoc=$jsondoc"\"html_contents\":\"$cont\""
        fi
    fi
    shift # past argument
    ;;

    --default)
    DEFAULT=YES
    ;;
    *)
          # unknown option
    ;;
esac
shift # past argument or value
done
if [ "$jsondoc" != "{" ]; then 
    jsondoc=$jsondoc","
fi
#atime=`date +"%c"`
atime=`date --utc +%FT%TZ`
jsondoc=$jsondoc"\"timestamp\":\"$atime\"}"
echo jsondoc = "${jsondoc}"
if [[ -n $1 ]]; then
    echo "Last line of file specified as non-opt/last argument:"
    tail -1 $1
fi

curl -X POST --header "Content-Type: application/json" --header "Accept: text/plain" -d "${jsondoc}" "http://devops-datastore.stage1.mybluemix.net/v1/pub_message"
