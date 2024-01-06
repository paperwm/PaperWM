#!/usr/bin/env bash
#
# Usage:
# monitor.sh
# monitor.sh --profile  # table like tab separated output
# monitor.sh --signals  # only show signals
# monitor.sh FILTER  # see https://dbus.freedesktop.org/doc/dbus-specification.html#message-bus-routing-match-rules
# monitor.sh type=signal

set -euo pipefail

ADDITIONAL_ARGS=()
FILTER=("path=/org/github/PaperWM")

main() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --profile)
                ADDITIONAL_ARGS+=( --profile )
                shift
                ;;
            --signals)
                FILTER+=( "type=signal" )
                shift
                ;;
            --*)
                ADDITIONAL_ARGS+=( "$1" )
                shift
                ;;
            *)
                FILTER+=( "$1" )
                shift
                ;;
        esac
    done

    local filter args
    filter=$(join_by "," "${FILTER[@]}")
    args=( "${ADDITIONAL_ARGS[@]}" )
    args+=( "${filter}" )

    { set -x; dbus-monitor "${args[@]}"; { set +x; } &>/dev/null; } | tail -n +5
}

join_by() {
    local IFS="$1"
    shift
    echo "$*"
}

main "$@"
