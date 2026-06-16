# OpenWrt Squid Profile UI

[![Docs](https://img.shields.io/badge/docs-user%20guide-blue)](./docs/user-guide.md)

[![CI](https://github.com/heralight/openwrt-squid-profile-ui/actions/workflows/openwrt-package.yml/badge.svg)](https://github.com/heralight/openwrt-squid-profile-ui/actions/workflows/openwrt-package.yml)

[![Latest Release](https://img.shields.io/github/v/release/heralight/openwrt-squid-profile-ui)](https://github.com/heralight/openwrt-squid-profile-ui/releases)

[![Stars](https://img.shields.io/github/stars/heralight/openwrt-squid-profile-ui?style=social)](https://github.com/heralight/openwrt-squid-profile-ui/stargazers)

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

LuCI exposes one application group under **Services -> Squid Profiles** with three tabs:

- `Profiles`
- `Devices`
- `LAN/VLAN Mapping`

## Screenshots

### Main menu

![Plugin main menu](docs/screenshots/Plugin%20main%20menu.png)

### Devices and profiles

![Devices profiles mapping list](docs/screenshots/Devices%20Profiles%20Mapping%20List.png)

### LAN/VLAN mapping editor

![LAN/VLAN profiles mapping editor](docs/screenshots/LAN-VLAN%20Profiles%20Mapping%20Edition.png)

## Storage and Validation Model

The plugin keeps explicit operator intent in UCI, under `/etc/config/squid_profiles`.
OpenWrt-discovered DHCP leases and LAN/VLAN interfaces are shown in LuCI, but they are only persisted when the operator assigns profiles to them.
The runtime Squid files are generated from the explicit UCI mappings and written to `/etc/squid`.

UCI sections are:

- `core` (`globals` section type): plugin-wide switch state. `squid_profiles.core.enabled` is the real service toggle and the helper exposes `enable` and `disable` subcommands to update it from SSH.
- `network` (`network` section type): covered CIDR, VLAN/LAN label, optional description and explicit profile assignments for whole networks. Custom CIDR rows can stay persisted even without a profile, but they are ignored by the Squid generator until at least one profile is assigned.
- `profile` (`profile` section type): profile name, description, allow/deny domains, edit mode.
- `vm` (`vm` section type): machine IP, hostname, VLAN/LAN label and assigned profiles. DHCP-discovered machines without a direct profile assignment stay display-only.

The generated runtime tree is:

```text
/etc/squid/
├── squid.conf
├── domains/
└── maps/
```

Validation is always done before the standard LuCI Save & Apply path reloads Squid:

1. UCI structure and domain syntax are checked by `/usr/libexec/squid-profiles validate`.
2. The helper generates a temporary Squid config.
3. Squid validates it with `squid -k parse`.
4. Only then the helper copies the config, creates a dated backup and reloads Squid.
5. OpenWrt's `Save & Apply` triggers the helper through the `squid_profiles` procd reload hook.

Detected devices and OpenWrt interfaces are not written to UCI unless you assign profiles to them. This keeps `/etc/config/squid_profiles` focused on explicit operator policy.

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
├── .github/
│   └── workflows/openwrt-package.yml
├── AGENTS.md
├── docs/
│   ├── technical.md
│   ├── packaging.md
│   ├── user-guide.md
│   └── screenshots/
│       ├── Devices Profiles Mapping Edition.png
│       ├── Devices Profiles Mapping List.png
│       ├── LAN-VLAN Profiles Mapping Edition.png
│       ├── LAN-VLAN Profiles Mapping List.png
│       ├── Plugin main menu.png
│       ├── Profile Edition.png
│       ├── Profiles Edition List .png
│       └── Profiles List .png
├── feeds.conf.example
├── LICENSE
├── README.md
├── openwrt-squid-profile-ui/
│   ├── Makefile
│   ├── LICENSE
│   └── files/
│       ├── etc/
│       │   ├── init.d/squid-profiles
│       │   ├── config/squid_profiles
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
├── test-platform/
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

Build the package with the OpenWrt SDK Docker image. The single source of truth for the OpenWrt package is `openwrt-squid-profile-ui/`; there is no second package copy elsewhere in this repository. The package Makefile is a normal OpenWrt source package Makefile with explicit `Package/luci-app-squid-profiles` blocks.

It declares:

```make
PKG_NAME:=luci-app-squid-profiles
PKG_VERSION:=0.1.0
PKG_RELEASE:=7
PKG_LICENSE:=BSD-2-Clause
PKG_LICENSE_FILES:=LICENSE
PKGARCH:=all
```

Runtime dependencies are:

```make
+luci-base +luci-compat +luci-lua-runtime +rpcd +uci +squid
```

Example OpenWrt 25 SDK Docker flow:

```sh
docker run --rm -v "$(pwd)":/work:ro -v "$(pwd)/bin":/builder/bin -it openwrt/sdk:mediatek-mt7622-main
[ ! -d ./scripts ] && ./setup.sh
mkdir -p package/feeds/custom
cp -a /work/openwrt-squid-profile-ui package/feeds/custom/luci-app-squid-profiles
./scripts/feeds update -a
./scripts/feeds install luci-app-squid-profiles
make defconfig
make package/luci-app-squid-profiles/check V=s
make package/luci-app-squid-profiles/compile V=s
make package/index V=s
```

### Local deployment from GitHub Actions artifacts

The GitHub Actions workflow produces two useful outputs:

- the package artifact containing `luci-app-squid-profiles_*.apk`
- the repository artifact containing the APK index metadata

For a direct local install on the target router, you usually only need the package artifact.

1. Download the workflow artifact from GitHub Actions.
2. Extract `luci-app-squid-profiles_*.apk`.
3. Copy it to the router:

```sh
scp luci-app-squid-profiles_*.apk root@192.168.1.1:/tmp/
```

4. Install it over SSH:

```sh
ssh root@192.168.1.1
apk update
apk add --allow-untrusted /tmp/luci-app-squid-profiles_*.apk
```

5. Validate the generated Squid configuration:

```sh
/usr/libexec/squid-profiles validate
squid -k parse
```

If you want repository-based installs instead of copying a single APK, publish both the `.apk` file and the repository index metadata generated by `make package/index`.

If you use tagged releases, you can also fetch the latest generated APK directly with `wget`:

```sh
APK_URL="$(wget -qO- "https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest" | sed -n 's/.*"browser_download_url": *"\([^"]*luci-app-squid-profiles_[^"]*\.apk\)".*/\1/p' | head -n1)"
wget -O /tmp/luci-app-squid-profiles.apk "$APK_URL"
```

The package depends on LuCI, rpcd, UCI and Squid. After installation, open LuCI and go to Services -> Squid Profiles.

The uci-defaults script only creates the plugin core section when `squid_profiles.core` does not exist. It does not seed fake profiles, fake networks or fake devices. The `Devices` and `LAN/VLAN Mapping` tabs read existing OpenWrt LAN/VLAN interfaces and DHCP leases, then store only the Squid profile assignments managed by the plugin.

User-oriented documentation lives in [`docs/user-guide.md`](docs/user-guide.md). It includes installation steps, common workflows and reference screenshots.
Technical notes live in [`docs/technical.md`](docs/technical.md). It explains the UCI schema, runtime files and SSH workflows.
Packaging and WAX206 build notes live in [`docs/packaging.md`](docs/packaging.md).

The repository also includes:

- `.github/workflows/openwrt-package.yml` to build SDK packages and upload package/repository artifacts.
- `feeds.conf.example` as a note for feed publication; the CI workflow copies `openwrt-squid-profile-ui/` directly into the SDK.

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

## Applying configuration

Use the standard OpenWrt Save & Apply button.

When the configuration is committed, OpenWrt automatically triggers:

/usr/libexec/squid-profiles apply

through the squid-profiles init service.
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

The test environment is under `test-platform/` and uses the official OpenWrt rootfs image. The container runs the image default init process, while compose mounts plugin files individually so the base LuCI installation remains intact:

```sh
podman compose -f test-platform/compose.yml up --build
podman exec -it openwrt-squid-profile-ui ash
```

It exposes:

```text
8080 -> 80
3128 -> 3128
2222 -> 22
```

Mounted development paths are file-level mounts for the LuCI menu, controller, RPC ACL, helper, init script and view directory. Runtime data uses directory mounts for `/etc/squid`, `/etc/config` and `/tmp`; the test entrypoint copies the image default OpenWrt config files into the mounted `/etc/config` directory if they are missing. This keeps the base LuCI installation from the image intact while local plugin edits remain visible without rebuilding the package.

If you change `files/usr/share/luci/menu.d/luci-app-squid-profiles.json`, delete the LuCI menu cache first:

```sh
podman exec -it openwrt-squid-profile-ui sh -lc 'rm -f /tmp/luci-indexcache*.json && /etc/init.d/uhttpd restart && /etc/init.d/rpcd restart'
```


Restarting `uhttpd` alone does not rebuild the cached LuCI menu index. LuCI recreates it on the next page load after the cache file is removed. If the browser still shows the old menu, do a hard reload or open LuCI in a private window. The helper itself is only invoked as:

```sh
/usr/libexec/squid-profiles init|generate|validate|apply|enable|disable|prune
```

Do not pass init script paths to the helper. Service control stays on `/etc/init.d/squid-profiles restart|stop`.

## Debug Commands

Inside OpenWrt or the Podman container:

```sh
/usr/libexec/squid-profiles init
/usr/libexec/squid-profiles validate
/usr/libexec/squid-profiles prune
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

These checks are intentionally lightweight and do not require a full OpenWrt SDK.
