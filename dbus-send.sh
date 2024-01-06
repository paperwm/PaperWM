#!/usr/bin/env bash
#
# Usage:
#

set -euo pipefail

main() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            action)
                shift
                trigger_action "$1"
                return
                ;;
            list-actions)
                shift
                list_actions
                return
                ;;
        esac
    done
}

trigger_action() {
    METHOD=TriggerAction call "string:$1"
}

list_actions() {
    local result
    result=$(METHOD=ListActions call)
    while IFS=' ' read -ra words; do
        for word in "${words[@]}"; do
            case "${word}" in
                array|\[|\])
                    ;;
                *)
                    echo "${word}"
                    ;;
            esac
        done
    done <<< "$result"
}

send() {
    local args
    args=( --dest=org.github.PaperWM )
    if [[ -n "${OPTIONS:-}" ]]; then
        args+=( "${OPTIONS}" )
    fi
    args+=(
        /org/github/PaperWM
        "org.github.PaperWM.${METHOD}"
        "$@"
    )

    set -x
    dbus-send "${args[@]}"
    { set +x; } &> /dev/null
}

call() {
    OPTIONS=--print-reply=literal send "$@"
}

global_rematch() {
    local s=$1 regex=$2
    while [[ $s =~ $regex ]]; do
        echo "${BASH_REMATCH[1]}"
        s=${s#*"${BASH_REMATCH[1]}"}
    done
}

join_by() {
    local IFS="$1"
    shift
    echo "$*"
}

main "$@"
