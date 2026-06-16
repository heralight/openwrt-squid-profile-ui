# Technical Notes

`luci-app-squid-profiles` uses UCI as the source of truth for explicit operator policy and generates Squid runtime files from it.
The editable config lives in `/etc/config/squid_profiles`.
The runtime Squid tree lives in `/etc/squid`.

LuCI navigation is split into three tabs under **Services -> Squid Profiles**:

- `Profiles`: profile creation and domain rules
- `Devices`: per-IP assignments from detected DHCP leases plus saved `vm` sections with direct profile assignments
- `LAN/VLAN Mapping`: OpenWrt network coverage and network-wide profile assignments, with discovered interfaces displayed only until they receive an explicit profile assignment

## Storage Schema

The helper and LuCI views use four section types:

- `core` with section type `globals`
- `network` with section type `network`
- `profile` with section type `profile`
- `vm` with section type `vm`

### `core`

Global state for the plugin.

Typical field:

- `enabled`: `1` or `0`

This is the real service toggle. The helper exposes `enable` and `disable` subcommands to update this field from SSH, and the init script reads this value to decide whether it may apply or reload Squid.

### `network`

Covered IPv4 networks.

Fields:

- `cidr`: IPv4 CIDR, for example `192.168.31.0/24`
- `vlan`: VLAN or LAN label
- `description`: optional text
- `source`: optional `system` or `custom` marker used by LuCI
- `profile`: optional UCI list of profile names assigned to the whole network

The `LAN/VLAN Mapping` view reads `/etc/config/network` and shows detected OpenWrt interfaces as display-only rows. They are not written back into UCI unless the operator explicitly assigns profiles to them. Custom CIDR rows created by the operator remain in UCI even when no profile is assigned, but the helper ignores them when generating ACL files until profiles are present.

### `profile`

Squid policy by name.

Fields:

- `name`: human-readable profile name
- `description`: optional note
- `edit_mode`: `lists` or `text`
- `allow_domain`: UCI list of allowed domains
- `deny_domain`: UCI list of denied domains
- `raw_rules`: text rules when `edit_mode=text`

The UI keeps `lists` and `text` exclusive:

- in `lists` mode, the dynamic lists are authoritative
- in `text` mode, the raw text block is authoritative
- switching mode converts the current source into the other representation

### `vm`

Per-device assignments.

Fields:

- `ip`: IPv4 address
- `name`: hostname if known
- `vlan`: VLAN or LAN label
- `profile`: UCI list of assigned profile names

The `Devices` view discovers DHCP leases through LuCI RPC and overlays saved `vm` sections from `/etc/config/squid_profiles`. Only leases with an explicit profile assignment are persisted as `vm` sections. A discovered lease with no direct profile assignment is displayed but not written into UCI. Device edit writes back only when the user assigns or clears one or more profiles.

## Runtime Artifacts

The helper generates:

```text
/etc/squid/squid.conf
/etc/squid/domains/*.txt
/etc/squid/maps/*.conf
```

The generated Squid skeleton is intentionally small and references the generated map files.

## Validation Flow

Every apply path follows the same order:

1. OpenWrt commits the UCI changes through the standard LuCI **Save & Apply** path.
2. The `squid_profiles` procd reload trigger starts `/etc/init.d/squid-profiles reload`.
3. The helper validates UCI structure and domain syntax in `/usr/libexec/squid-profiles apply` or `validate`.
4. Generate a temporary Squid configuration.
5. Run:

```sh
squid -k parse
```

6. If parsing succeeds, back up the previous `/etc/squid/squid.conf` with a dated filename.
7. Copy the new config into place.
8. Reconfigure Squid.

The current implementation backs up only files whose content changes, using the format `filename.YYYYMMDD-HHMMSS.bak`.
This applies to the generated Squid config, the per-profile domain lists and the map files. If parsing fails, the helper stops and returns the full output to LuCI.

## OpenWrt Package

The source package lives in `openwrt-squid-profile-ui/`.

Package metadata:

```make
PKG_NAME:=luci-app-squid-profiles
PKG_VERSION:=0.1.0
PKG_RELEASE:=7
PKG_LICENSE:=BSD-2-Clause
PKG_LICENSE_FILES:=LICENSE
PKGARCH:=all
```

The package ships scripts and LuCI resources, so `Build/Compile` is empty and `Package/luci-app-squid-profiles/install` copies files from `files/` into the package root.

Runtime dependencies:

```make
+luci-base +luci-compat +luci-lua-runtime +rpcd +uci +squid
```

Run package checks in an OpenWrt 25 SDK container:

```sh
[ ! -d ./scripts ] && ./setup.sh
make defconfig
make package/luci-app-squid-profiles/check V=s
make package/luci-app-squid-profiles/compile V=s
make package/index V=s
```

See [`packaging.md`](packaging.md) for the full SDK flow and Netgear WAX206 build example.

## Feed and CI Publishing

The single package source is `openwrt-squid-profile-ui/`. There is no duplicate package tree under `packages/`.

For SDK builds, copy that directory into the SDK package namespace:

```sh
mkdir -p package/feeds/custom
cp -a /work/openwrt-squid-profile-ui package/feeds/custom/luci-app-squid-profiles
```

GitHub Actions workflow:

```text
.github/workflows/openwrt-package.yml
```

The workflow uses a prebuilt OpenWrt SDK Docker image, runs package metadata checks, compiles the package, runs `make package/index`, and uploads APK package/repository artifacts. The default SDK image is:

```text
openwrt/sdk:mediatek-mt7622-main
```

The target is OpenWrt 25/APK only.

## SSH Workflows

### Inspect

```sh
uci show squid_profiles
```

### Edit with `uci`

```sh
uci set squid_profiles.@profile[0].name='restricted'
uci add_list squid_profiles.@profile[0].deny_domain='example.com'
uci commit squid_profiles
```

### Edit by hand

Use `vi /etc/config/squid_profiles` only when necessary.
After editing, always run:

```sh
uci commit squid_profiles
/usr/libexec/squid-profiles validate
/usr/libexec/squid-profiles apply
```

### Initialize or recover

```sh
/usr/libexec/squid-profiles init
```

This creates the directory tree, writes a Squid skeleton and backs up an unmanaged `/etc/squid/squid.conf` if one already exists.

### Prune unmapped sections

```sh
/usr/libexec/squid-profiles prune
```

This removes `vm` sections that no longer have a profile assignment and removes `network` sections with `source=system` when they have no profile assignment. Custom `network` sections without profiles remain in UCI, but the helper ignores them until they receive at least one profile.

## Notes for Maintainers

- The UCI file is the editable source.
- `/etc/squid/squid.conf` is generated output.
- Do not add a second, divergent config source.
- Keep validation in the helper, not only in the UI.
- Keep the list/full-text profile modes exclusive.
