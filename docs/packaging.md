# Packaging and WAX206 Test Build

This project is packaged as a normal OpenWrt source package. The package source is the `openwrt-squid-profile-ui/` directory.

## Package Layout

```text
openwrt-squid-profile-ui/
├── Makefile
├── LICENSE
└── files/
    ├── etc/
    │   ├── config/squid_profiles
    │   ├── init.d/squid-profiles
    │   └── uci-defaults/90_squid_profiles
    ├── usr/
    │   ├── lib/lua/luci/controller/squid_profiles.lua
    │   ├── libexec/squid-profiles
    │   └── share/
    │       ├── luci/menu.d/luci-app-squid-profiles.json
    │       └── rpcd/acl.d/luci-app-squid-profiles.json
    └── www/luci-static/resources/view/squid-profiles/
        ├── main.js
        ├── networks.js
        └── profiles.js
```

There is no `src/` directory because this package does not compile target binaries. It installs LuCI JavaScript, a small Lua controller, shell helpers, a UCI config file, an init script and ACL/menu metadata.

## Package Makefile Model

The package follows the OpenWrt source package model:

- `PKG_NAME:=luci-app-squid-profiles`
- `PKG_VERSION:=0.1.0`
- `PKG_RELEASE:=2`
- `PKG_LICENSE:=BSD-2-Clause`
- `PKG_LICENSE_FILES:=LICENSE`
- `PKGARCH:=all`
- `Package/luci-app-squid-profiles/install` copies files into the IPK root under `$(1)`
- `Package/luci-app-squid-profiles/conffiles` marks `/etc/config/squid_profiles` as configuration

Runtime dependencies are declared in `DEPENDS`:

```make
+luci-base +luci-compat +luci-lua-runtime +rpcd +uci +squid
```

The package is architecture-independent because it ships scripts and LuCI resources only. Build it with the SDK matching the target router anyway, because the router will install dependencies from that same OpenWrt release and target feed.

## Generic SDK Build

From an OpenWrt SDK:

```sh
cd /path/to/openwrt-sdk
mkdir -p package/feeds/custom
ln -s /path/to/openwrt-squid-profile-ui/openwrt-squid-profile-ui package/feeds/custom/luci-app-squid-profiles
./scripts/feeds update -a
./scripts/feeds install luci-app-squid-profiles
make package/luci-app-squid-profiles/check V=s
make package/luci-app-squid-profiles/compile V=s
```

The IPK is created under a target package directory, for example:

```sh
find bin/packages -name 'luci-app-squid-profiles_*.ipk' -print
```

Install it on a router with:

```sh
opkg install ./luci-app-squid-profiles_*.ipk
```

If `opkg` cannot resolve dependencies, install with the router online and configured with package feeds for the same OpenWrt release, or copy the required dependency IPKs from the same SDK/release package feed.

## Netgear WAX206 Build

The Netgear WAX206 is built by OpenWrt under the `mediatek/mt7622` target. The OpenWrt download tree for release `24.10.5` contains WAX206 images and the matching `mediatek/mt7622` SDK.

Reference URLs:

- `https://downloads.openwrt.org/releases/24.10.5/targets/mediatek/mt7622/`
- `https://openwrt.org/docs/techref/targets/mediatek`

Use the SDK matching the firmware installed on the router. For a WAX206 running OpenWrt `24.10.5`, use:

```sh
mkdir -p ~/openwrt-sdk-wax206
cd ~/openwrt-sdk-wax206
wget https://downloads.openwrt.org/releases/24.10.5/targets/mediatek/mt7622/openwrt-sdk-24.10.5-mediatek-mt7622_gcc-13.3.0_musl.Linux-x86_64.tar.zst
tar -I zstd -xf openwrt-sdk-24.10.5-mediatek-mt7622_gcc-13.3.0_musl.Linux-x86_64.tar.zst
cd openwrt-sdk-24.10.5-mediatek-mt7622_gcc-13.3.0_musl.Linux-x86_64
mkdir -p package/feeds/custom
ln -s /path/to/openwrt-squid-profile-ui/openwrt-squid-profile-ui package/feeds/custom/luci-app-squid-profiles
./scripts/feeds update -a
./scripts/feeds install luci-app-squid-profiles
make package/luci-app-squid-profiles/check V=s
make package/luci-app-squid-profiles/compile V=s
find bin/packages -name 'luci-app-squid-profiles_*.ipk' -print
```

Transfer the IPK to the WAX206:

```sh
scp bin/packages/*/*/luci-app-squid-profiles_*.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1
opkg update
opkg install /tmp/luci-app-squid-profiles_*.ipk
/usr/libexec/squid-profiles init
/usr/libexec/squid-profiles validate
```

Open LuCI:

```text
Services -> Squid Profiles
```

Expected tabs:

- `Profiles`
- `Devices`
- `LAN/VLAN Mapping`

## Router-Side Validation

After installation or changes:

```sh
uci show squid_profiles
/usr/libexec/squid-profiles validate
/usr/libexec/squid-profiles apply
squid -k parse
logread
```

The plugin must not reload Squid unless validation succeeds.

## Common Build Problems

- Wrong SDK: use the SDK for the exact OpenWrt release and target installed on the router.
- Missing dependencies at install: run `opkg update` and ensure the router package feeds match the firmware release.
- Local changes not included: the SDK builds committed and current filesystem content from the symlinked package directory; run `make package/luci-app-squid-profiles/{clean,compile} V=s` after packaging changes.
- Stale package metadata: rerun `./scripts/feeds update -a` and `./scripts/feeds install luci-app-squid-profiles`.
