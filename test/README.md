# Podman test environment

This directory runs an OpenWrt rootfs container with the LuCI application mounted from the working tree. Edits under `../openwrt-squid-profile-ui/files` are visible inside the container without rebuilding an IPK.

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

- `../openwrt-squid-profile-ui/files/usr/share/luci` -> `/usr/share/luci`
- `../openwrt-squid-profile-ui/files/usr/share/rpcd` -> `/usr/share/rpcd`
- `../openwrt-squid-profile-ui/files/usr/libexec` -> `/usr/libexec`
- `../openwrt-squid-profile-ui/files/etc/uci-defaults` -> `/etc/uci-defaults`
- `../openwrt-squid-profile-ui/files/etc/init.d` -> `/etc/init.d`
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
