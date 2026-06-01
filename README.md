# OpenWrt Squid Profile UI

LuCI/OpenWrt package for managing Squid proxy profiles by IP address, VLAN/LAN and covered IPv4 network without manually editing `/etc/squid/squid.conf`.

The package is designed for low-power OpenWrt routers: no external frontend framework, small shell helpers, UCI-backed configuration and explicit validation before Squid is reconfigured.

## Features

- Main LuCI page listing detected machines from OpenWrt host hints, DHCP/ARP-derived data where available and saved UCI assignments.
- Per-machine display of IP address, hostname, VLAN/LAN and assigned Squid profiles.
- Multi-profile assignment per IP address.
- VLAN/LAN filter and sort preference persisted in browser local storage.
- Covered network management with IPv4 CIDR, VLAN/LAN label and optional description.
- Profile management with name, description, allowed domains, denied domains, dynamic lists and full text fields.
- Local domain validation for invalid domains, duplicates and obvious allow/deny conflicts.
- First-run Squid initialization with dated backup of existing `/etc/squid/squid.conf`.
- Global validation and apply actions, plus profile-level validate/apply buttons.
- Mandatory `squid -k parse` before any Squid reload.

## Repository Structure

```text
.
├── AGENTS.md
├── LICENSE
├── README.md
├── openwrt-squid-profile-ui/
│   ├── Makefile
│   └── files/
│       ├── etc/
│       │   ├── init.d/squid-profiles
│       │   └── uci-defaults/90_squid_profiles
│       └── usr/
│           ├── libexec/squid-profiles
│           └── share/
│               ├── luci/
│               │   ├── controller/squid-profiles.lua
│               │   ├── menu.d/luci-app-squid-profiles.json
│               │   └── htdocs/luci-static/resources/view/squid-profiles/
│               │       ├── main.js
│               │       ├── networks.js
│               │       └── profiles.js
│               └── rpcd/acl.d/luci-app-squid-profiles.json
├── test/
│   ├── Dockerfile
│   ├── compose.yml
│   ├── docker-compose.yml
│   ├── README.md
│   └── runtime/
└── tests/
    ├── js/
    ├── shell/
    └── fixtures/
```

## Installation on OpenWrt

Build the package with the OpenWrt SDK or include `openwrt-squid-profile-ui` in a package feed, then install the generated IPK:

```sh
opkg install ./luci-app-squid-profiles_*.ipk
```

The package depends on LuCI, rpcd, UCI and Squid. After installation, open LuCI and go to Services -> Squid Profiles.

## Initialization Behavior

On first install or service start, `/usr/libexec/squid-profiles init` ensures this tree exists:

```text
/etc/squid/
├── squid.conf
├── domains/
└── maps/
```

If `/etc/squid/squid.conf` exists and is not already managed by this plugin, it is renamed to a dated backup:

```text
/etc/squid/squid.conf.YYYYMMDD.bak
```

If a backup for the same day already exists, the helper creates a unique suffix such as:

```text
/etc/squid/squid.conf.20260601.bak.1
```

The helper then writes a Squid skeleton compatible with generated profile ACLs. The UI and helper report the backup path, directories and generated files in their command output.

## Validation and Apply Flow

The apply path is intentionally strict:

1. Save UCI changes.
2. Generate domain files under `/etc/squid/domains` and map rules under `/etc/squid/maps`.
3. Write the plugin-managed Squid skeleton.
4. Run:

```sh
squid -k parse
```

5. Only if validation succeeds, run:

```sh
squid -k reconfigure
```

If validation fails, Squid is not reconfigured and the full command output is returned to LuCI.

## Podman Test Environment

The test environment is under `test/` and uses the official OpenWrt rootfs image:

```sh
podman compose -f test/compose.yml up --build
podman exec -it openwrt-squid-profile-ui ash
```

It exposes:

```text
8080 -> 80
3128 -> 3128
2222 -> 22
```

Mounted development paths:

```text
./openwrt-squid-profile-ui/files/usr/share/luci   -> /usr/share/luci
./openwrt-squid-profile-ui/files/usr/share/rpcd   -> /usr/share/rpcd
./openwrt-squid-profile-ui/files/usr/libexec      -> /usr/libexec
./openwrt-squid-profile-ui/files/etc/uci-defaults -> /etc/uci-defaults
./openwrt-squid-profile-ui/files/etc/init.d       -> /etc/init.d
./test/runtime/etc-squid                          -> /etc/squid
./test/runtime/config                             -> /etc/config
./test/runtime/log                                -> /tmp
```

This lets you edit the plugin locally and refresh LuCI or rerun commands in the container without rebuilding the IPK.

## Debug Commands

Inside OpenWrt or the Podman container:

```sh
/usr/libexec/squid-profiles init
/usr/libexec/squid-profiles validate
/usr/libexec/squid-profiles apply
squid -k parse
squid -k reconfigure
logread
```

## Local Repository Checks

```sh
sh tests/shell/static_checks.sh
node tests/js/static_checks.js
```

These checks are intentionally lightweight and do not replace OpenWrt SDK builds or runtime testing in the rootfs container.

## Known Limitations

- Machine discovery depends on host hints available on the OpenWrt target.
- The generated Squid policy is intentionally simple and may need extension for advanced proxy rules.
- The local checks validate structure and syntax patterns, not full LuCI runtime behavior.
- The Podman image tag follows the `openwrt/rootfs` tags available on the host at build time.

## Contribution Rules

- Keep the plugin small and readable.
- Do not add heavy dependencies or frontend frameworks.
- Do not bypass `squid -k parse` before reload.
- Do not overwrite `/etc/squid/squid.conf` without a backup.
- Surface validation errors clearly to the user.
- Keep comments in code in English.
