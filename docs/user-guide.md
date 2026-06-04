# Squid Profiles User Guide

`luci-app-squid-profiles` is a LuCI package for managing Squid access profiles on OpenWrt without editing `/etc/squid/squid.conf` by hand.

The interface is designed for low-power routers: it keeps the configuration UCI-backed, avoids heavy frontend dependencies, and validates Squid before every apply.

## Installation

### OpenWrt package install

Install the generated APK on an OpenWrt 25 router:

```sh
apk update
apk add --allow-untrusted ./luci-app-squid-profiles_*.apk
```

The package depends on LuCI, rpcd, UCI and Squid.

### Simple local deployment from GitHub Actions

If you build the package through GitHub Actions, download the workflow artifact that contains `luci-app-squid-profiles_*.apk`, then copy it to the router:

```sh
scp luci-app-squid-profiles_*.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1
apk add --allow-untrusted /tmp/luci-app-squid-profiles_*.apk
```

Then validate the generated Squid config:

```sh
/usr/libexec/squid-profiles validate
squid -k parse
```

Build it with an OpenWrt 25 SDK Docker image:

```sh
[ ! -d ./scripts ] && ./setup.sh
make defconfig
make package/luci-app-squid-profiles/check V=s
make package/luci-app-squid-profiles/compile V=s
make package/index V=s
```

See [`packaging.md`](packaging.md) for a full SDK workflow and a Netgear WAX206 example.

### First start

On first run, the plugin ensures this layout exists:

```text
/etc/squid/
├── squid.conf
├── domains/
└── maps/
```

If an existing `squid.conf` is present and not managed by the plugin, it is backed up with a dated filename before any new skeleton is created.

## Enable Or Disable The Service

The helper exposes explicit `enable` and `disable` subcommands. Both toggle `squid_profiles.core.enabled`, which is the real service switch used by the init script.

To enable the plugin-managed Squid generation:

```sh
/usr/libexec/squid-profiles enable
/etc/init.d/squid-profiles restart
```

To disable it:

```sh
/usr/libexec/squid-profiles disable
/etc/init.d/squid-profiles stop
```

When disabled, the init script leaves `/etc/squid/squid.conf` untouched and refuses reload-triggered apply operations.

## What It Does

- Lists detected machines from OpenWrt DHCP leases and saved UCI assignments.
- Lets you assign one or more Squid profiles to an IP address.
- Lets you map OpenWrt LAN/VLAN networks or additional custom CIDRs to one or more profiles.
- Lets you create Squid profiles with either list-based editing or a full-text rules mode.
- Validates the generated Squid configuration with `squid -k parse` before applying changes.
- Keeps OpenWrt-discovered devices and interfaces display-only until you explicitly assign profiles to them.

The LuCI application appears under **Services -> Squid Profiles** with three tabs:

- `Profiles`
- `Devices`
- `LAN/VLAN Mapping`

## Data Model

The plugin stores explicit operator policy in `/etc/config/squid_profiles`.
It does not treat `/etc/squid/squid.conf` as the editable source of truth.

The main UCI sections are:

- `core`: global plugin state.
- `network`: covered CIDR, VLAN or LAN label, optional description and explicit profile assignments for whole networks. Custom CIDR rows can stay in UCI without a profile, but the Squid helper ignores them until you assign at least one profile.
- `profile`: profile name, description, allow/deny domains and editing mode.
- `vm`: device IP, hostname, VLAN or LAN label and assigned profiles. DHCP-discovered devices without a direct profile stay display-only.

When you press the standard LuCI **Save & Apply** button, OpenWrt commits the UCI data first, then the helper regenerates `/etc/squid/squid.conf`, `/etc/squid/domains/*.txt` and `/etc/squid/maps/*.conf` after validating the configuration with `squid -k parse`.

## Domain Syntax

Squid wildcard matching uses a leading dot:

```text
.example.com
```

Do not use:

```text
*.example.com
```

In list mode, enter exact domains or leading-dot wildcard domains. In full-text mode, use one rule per line:

```text
allow .example.com
deny blocked.example.net
```

## Use Cases

### 1. Home network with a guest VLAN

Use the detected OpenWrt guest network in `LAN/VLAN Mapping`, then assign a restrictive profile to the whole network or to selected guest devices in `Devices`. OpenWrt-discovered rows remain display-only until you assign profiles to them.

### 2. Family-safe browsing policy

Use a profile with allowed and denied domains to keep access focused on approved services.

### 3. Device-specific proxy policy

Assign multiple profiles to a single IP when a device needs a combined policy, for example a baseline profile plus a temporary exception profile.

### 4. Per-VLAN policy review

Filter the `Devices` list by VLAN or LAN label to review which devices are covered and which profiles are attached.

## Screenshots

The following reference screenshots are included with the repository.

### Main menu

![Main menu](screenshots/Plugin%20main%20menu.png)

### Profiles list

![Profiles list](screenshots/Profiles%20List%20.png)

### Profile editor

![Profile editor](screenshots/Profile%20Edition.png)

### Devices mapping

![Devices mapping list](screenshots/Devices%20Profiles%20Mapping%20List.png)

### Devices mapping editor

![Devices mapping editor](screenshots/Devices%20Profiles%20Mapping%20Edition.png)

### LAN/VLAN mapping

![LAN/VLAN mapping list](screenshots/LAN-VLAN%20Profiles%20Mapping%20List.png)

### LAN/VLAN mapping editor

![LAN/VLAN mapping editor](screenshots/LAN-VLAN%20Profiles%20Mapping%20Edition.png)

## Suggested Workflow

1. Open **Services -> Squid Profiles** in LuCI.
2. Create one or more profiles in `Profiles`.
3. Review detected OpenWrt networks in `LAN/VLAN Mapping` and assign network-wide profiles if needed.
4. Assign per-IP profiles to detected machines in `Devices`.
5. Click **Validate configuration** if you want a manual parse check.
6. Review the Squid output.
7. Click the standard **Save & Apply** button only after validation succeeds.

## Validation And Apply

Every apply path validates the generated configuration first:

```sh
squid -k parse
```

If validation fails, Squid is not reloaded and the error output is returned in LuCI.

If the helper applies changes successfully, it backs up only the files whose content actually changed. Backups use a timestamped suffix such as:

```text
filename.YYYYMMDD-HHMMSS.bak
```

This applies to the generated Squid config, domain lists and map files.

## SSH Administration

The recommended SSH workflow is to use the helper and `uci` tools instead of editing runtime files.

### Inspect the current config

```sh
uci show squid_profiles
```

### Edit with the UCI CLI

Use the CLI when you want a transactional change:

```sh
uci set squid_profiles.@profile[0].description='Updated profile'
uci add_list squid_profiles.@profile[0].deny_domain='example.com'
uci commit squid_profiles
```

Then validate and apply:

```sh
/usr/libexec/squid-profiles validate
/usr/libexec/squid-profiles prune
/usr/libexec/squid-profiles apply
```

If you need only a manual check after copying the generated APK, the minimum sequence is:

```sh
/usr/libexec/squid-profiles validate
squid -k parse
```

### Edit the config file directly

If you prefer a text editor, modify `/etc/config/squid_profiles` with `vi` or `nano`, then commit the UCI config and run the helper:

```sh
vi /etc/config/squid_profiles
uci commit squid_profiles
/usr/libexec/squid-profiles validate
/usr/libexec/squid-profiles apply
```

Do not edit `/etc/squid/squid.conf` as the primary source. It is regenerated by the helper and may be backed up and replaced during apply.

## Debug Commands

```sh
logread
squid -k parse
squid -k reconfigure
/usr/libexec/squid-profiles init
/usr/libexec/squid-profiles validate
/usr/libexec/squid-profiles apply
```

## Notes

- The list and full-text profile modes are exclusive. Use one source of truth at a time.
- Only IPs covered by the configured networks can receive profile assignments.
- The plugin keeps dated backups before rewriting generated Squid files whose content changes.
