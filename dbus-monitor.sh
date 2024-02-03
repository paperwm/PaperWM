#!/usr/bin/env bash
#
# Usage:
# dbus-monitor.sh
# dbus-monitor.sh --profile  # table like tab separated output
# dbus-monitor.sh --signals  # only show signals
# dbus-monitor.sh FILTER  # see https://dbus.freedesktop.org/doc/dbus-specification.html#message-bus-routing-match-rules
# dbus-monitor.sh type=signal

set -euo pipefail

ADDITIONAL_ARGS=()
FILTER=("path=/org/github/PaperWM")

script_name=$(basename "${BASH_SOURCE[0]}")

usage() {
    cat <<EOF
Usage: ${script_name} [-h|--help] [--profile] [--signals] [FILTER]

Monitor dbus messages to/from PaperWM.

Available options:

  --profile   Output table like, tab seperated data
  --signals   Only show signals
  FITLER      Additional filter to be passed to dbus-monitor, multiple can be provided.

Any other options (prefixed with --) are passed as is to dbus-monitor.

EOF
}

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
            -h|--help)
                usage
                exit
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
