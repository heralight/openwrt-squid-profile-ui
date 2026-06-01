# OpenWrt Squid Profile UI

LuCI/OpenWrt package for managing Squid proxy profiles by IP address, VLAN/LAN and covered IPv4 network without manually editing `/etc/squid/squid.conf`.

The package is designed for low-power OpenWrt routers: no external frontend framework, small shell helpers, UCI-backed configuration and explicit validation before Squid is reconfigured.

## Features

- Main LuCI page listing detected machines from OpenWrt host hints, DHCP/ARP-derived data where available and saved UCI assignments.
- Per-machine display of IP address, hostname, VLAN/LAN and assigned Squid profiles.
- Multi-profile assignment per IP address.
- VLAN/LAN filter and sort preference persisted in browser local storage.
- Covered network management with IPv4 CIDR, VLAN/LAN label and optional description.
- Profile management with name, description, allowed domains, denied domains, dynamic lists and an exclusive full-text rules mode.
- Local domain validation for invalid domains, duplicates, obvious allow/deny conflicts and Squid wildcard syntax.
- First-run Squid initialization with dated backup of existing `/etc/squid/squid.conf`.
- Dated backup before every effective rewrite of `/etc/squid/squid.conf`.
- Global validation and apply actions, plus profile-level validate/apply buttons.
- Mandatory `squid -k parse` before any Squid reload.

## Storage and Validation Model

The plugin keeps its source of truth in UCI, under `/etc/config/squid_profiles`.
The runtime Squid files are generated from that config and written to `/etc/squid`.

UCI sections are:

- `core` (`globals` section type): plugin-wide switch state.
- `network` (`network` section type): covered CIDR, VLAN/LAN label and optional description.
- `profile` (`profile` section type): profile name, description, allow/deny domains, edit mode.
- `vm` (`vm` section type): machine IP, hostname, VLAN/LAN label and assigned profiles.

The generated runtime tree is:

```text
/etc/squid/
├── squid.conf
├── domains/
└── maps/
```

Validation is always done before apply:

1. UCI structure and domain syntax are checked by `/usr/libexec/squid-profiles validate`.
2. The helper generates a temporary Squid config.
3. Squid validates it with `squid -k parse`.
4. Only then the helper copies the config, creates a dated backup and reloads Squid.

For SSH work, prefer the helper and `uci` commands:

```sh
uci show squid_profiles
/usr/libexec/squid-profiles validate
/usr/libexec/squid-profiles apply
```

If you edit `/etc/config/squid_profiles` directly, always finish with:

```sh
uci commit squid_profiles
/usr/libexec/squid-profiles validate
/usr/libexec/squid-profiles apply
```

The helper also supports:

```sh
/usr/libexec/squid-profiles init
```

This creates the Squid skeleton and backups any unmanaged `/etc/squid/squid.conf` before replacement.

## Repository Structure

```text
.
├── AGENTS.md
├── docs/
│   ├── technical.md
│   ├── user-guide.md
│   └── screenshots/
│       ├── main-view.svg
│       ├── networks-view.svg
│       └── profiles-view.svg
├── LICENSE
├── README.md
├── openwrt-squid-profile-ui/
│   ├── Makefile
│   └── files/
│       ├── etc/
│       │   ├── init.d/squid-profiles
│       │   └── uci-defaults/90_squid_profiles
│       ├── usr/
│       │   ├── lib/lua/luci/controller/squid_profiles.lua
│       │   ├── libexec/squid-profiles
│       │   └── share/
│       │       ├── luci/menu.d/luci-app-squid-profiles.json
│       │       └── rpcd/acl.d/luci-app-squid-profiles.json
│       └── www/luci-static/resources/view/squid-profiles/
│           ├── main.js
│           ├── networks.js
│           └── profiles.js
├── test/
│   ├── Dockerfile
│   ├── compose.yml
│   ├── entrypoint.sh
│   ├── README.md
│   └── runtime/
└── tests/
    ├── js/
    ├── shell/
    └── fixtures/
```

## Installation on OpenWrt

Build the package with the OpenWrt SDK or include `openwrt-squid-profile-ui` in a package feed. The package Makefile declares the runtime dependencies with `LUCI_DEPENDS`:

```make
+luci-base +luci-compat +rpcd +uci +squid
```

Example SDK flow:

```sh
cd /path/to/openwrt-sdk
mkdir -p package/feeds/custom
ln -s /path/to/openwrt-squid-profile-ui/openwrt-squid-profile-ui package/feeds/custom/luci-app-squid-profiles
./scripts/feeds update -a
./scripts/feeds install luci-app-squid-profiles
make package/luci-app-squid-profiles/compile V=s
```

Install the generated IPK on the router:

```sh
opkg install ./luci-app-squid-profiles_*.ipk
```

The package depends on LuCI, rpcd, UCI and Squid. After installation, open LuCI and go to Services -> Squid Profiles.

The uci-defaults script also seeds a minimal sample configuration when `squid_profiles.core` does not exist: three covered networks, two profiles and one sample machine. Existing non-empty plugin configuration is preserved.

User-oriented documentation lives in [`docs/user-guide.md`](docs/user-guide.md). It includes installation steps, common workflows and reference screenshots.
Technical notes live in [`docs/technical.md`](docs/technical.md). It explains the UCI schema, runtime files and SSH workflows.

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

On later applies, the helper validates the generated temporary configuration first, then compares each generated file with its current on-disk version. It backs up only files whose content changes, using the format:

```text
nomdufichier.YYYYMMDD-HHMMSS.bak
```

That applies to `/etc/squid/squid.conf`, `/etc/squid/domains/*.txt` and `/etc/squid/maps/*.conf`.

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

The test environment is under `test/` and uses the official OpenWrt rootfs image. The container runs the image default init process, while compose mounts plugin files individually so the base LuCI installation remains intact:

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

Mounted development paths are file-level mounts for the LuCI menu, controller, RPC ACL, helper, init script and view directory. Runtime data uses directory mounts for `/etc/squid`, `/etc/config` and `/tmp`; the test entrypoint copies the image default OpenWrt config files into the mounted `/etc/config` directory if they are missing. This keeps the base LuCI installation from the image intact while local plugin edits remain visible without rebuilding the IPK.

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
