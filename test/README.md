# Podman test environment

This directory runs an OpenWrt rootfs container with the LuCI application mounted from the working tree. Plugin files are mounted individually so the base LuCI installation from the image remains available while local plugin edits are still visible without rebuilding an IPK.

## Start

```sh
podman compose -f test/compose.yml up --build
```

Open LuCI at <http://localhost:8080/>.

## Shell

```sh
podman exec -it openwrt-squid-profile-ui ash
```

## Mounted paths

- `../openwrt-squid-profile-ui/files/usr/share/luci/menu.d/luci-app-squid-profiles.json` -> `/usr/share/luci/menu.d/luci-app-squid-profiles.json`
- `../openwrt-squid-profile-ui/files/usr/lib/lua/luci/controller/squid_profiles.lua` -> `/usr/lib/lua/luci/controller/squid_profiles.lua`
- `../openwrt-squid-profile-ui/files/www/luci-static/resources/view/squid-profiles` -> `/www/luci-static/resources/view/squid-profiles`
- `../openwrt-squid-profile-ui/files/usr/share/rpcd/acl.d/luci-app-squid-profiles.json` -> `/usr/share/rpcd/acl.d/luci-app-squid-profiles.json`
- `../openwrt-squid-profile-ui/files/usr/libexec/squid-profiles` -> `/usr/libexec/squid-profiles`
- `../openwrt-squid-profile-ui/files/etc/uci-defaults/90_squid_profiles` -> `/etc/uci-defaults/90_squid_profiles`
- `../openwrt-squid-profile-ui/files/etc/init.d/squid-profiles` -> `/etc/init.d/squid-profiles`
- `./runtime/etc-squid` -> `/etc/squid`
- `./runtime/config` -> `/etc/config`
- `./runtime/log` -> `/tmp`

## Useful commands inside the container

```sh
/etc/uci-defaults/90_squid_profiles
/usr/libexec/squid-profiles init
/usr/libexec/squid-profiles validate
/usr/libexec/squid-profiles apply
squid -k parse
squid -k reconfigure
logread
```
