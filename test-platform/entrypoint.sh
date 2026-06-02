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
cat >/tmp/dhcp.leases <<EOF
1799999999 02:11:22:33:44:10 192.168.31.10 pc-compta *
1799999999 02:11:22:33:44:11 192.168.31.11 pc-dev *
1799999999 02:11:22:33:44:12 192.168.31.12 pc-direction *
EOF
exec /sbin/init
