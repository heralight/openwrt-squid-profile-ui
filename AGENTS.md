# AGENTS.md

This repository contains a LuCI/OpenWrt package for managing Squid profiles by IP address, VLAN/LAN and covered IPv4 network. The goal is a small, readable and robust interface suitable for low-power OpenWrt routers.

## Project Layout

- `openwrt-squid-profile-ui/`: installable OpenWrt/LuCI package.
- `openwrt-squid-profile-ui/files/www/luci-static/resources/view/squid-profiles/`: LuCI JavaScript views.
- `openwrt-squid-profile-ui/files/usr/lib/lua/luci/controller/squid_profiles.lua`: LuCI HTTP endpoints used by the views.
- `openwrt-squid-profile-ui/files/usr/libexec/squid-profiles`: shell helper that initializes, validates, generates and applies Squid configuration.
- `openwrt-squid-profile-ui/files/etc/uci-defaults/`: package first-install defaults.
- `openwrt-squid-profile-ui/files/etc/init.d/`: OpenWrt init integration.
- `test/`: Podman/OpenWrt rootfs test environment.
- `tests/`: lightweight repository checks.

## Coding Conventions

- Keep LuCI JavaScript modern, dependency-free and compatible with LuCI modules already present on OpenWrt.
- Keep shell scripts POSIX `sh` compatible.
- Keep comments in code in English.
- Prefer explicit error messages over silent fallback behavior.
- Keep changes narrowly scoped to this package and its test environment.

## Testing

Run local static checks from the repository root:

```sh
sh tests/shell/static_checks.sh
node tests/js/static_checks.js
```

Run the OpenWrt test container:

```sh
podman compose -f test/compose.yml up --build
podman exec -it openwrt-squid-profile-ui ash
```

Inside the container, useful checks are:

```sh
/etc/uci-defaults/90_squid_profiles
/usr/libexec/squid-profiles init
/usr/libexec/squid-profiles validate
/usr/libexec/squid-profiles apply
squid -k parse
logread
```

## Never Do This

- Never overwrite `/etc/squid/squid.conf` without creating a dated backup first, including normal apply operations.
- Never apply or reload Squid without running `squid -k parse` first.
- Never hide validation errors from the UI or logs.
- Never add a heavy dependency or external frontend framework.
- Never modify unrelated system files.
- Never make destructive changes silently.
