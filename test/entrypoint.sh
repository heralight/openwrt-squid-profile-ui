#!/bin/sh

set -eu

mkdir -p /etc/config

if [ -d /rom/etc-config-defaults ]; then
	for cfg in /rom/etc-config-defaults/*; do
		[ -e "$cfg" ] || continue
		target="/etc/config/${cfg##*/}"
		[ -e "$target" ] || cp "$cfg" "$target"
	done
fi

[ -f /etc/config/squid_profiles ] || touch /etc/config/squid_profiles

exec /sbin/init
