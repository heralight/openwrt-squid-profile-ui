# Technical Notes

`luci-app-squid-profiles` uses UCI as the source of truth and generates Squid runtime files from it.
The editable config lives in `/etc/config/squid_profiles`.
The runtime Squid tree lives in `/etc/squid`.

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

### `network`

Covered IPv4 networks.

Fields:

- `cidr`: IPv4 CIDR, for example `192.168.31.0/24`
- `vlan`: VLAN or LAN label
- `description`: optional text

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

1. Save or commit UCI changes.
2. Validate UCI structure and domain syntax in `/usr/libexec/squid-profiles validate`.
3. Generate a temporary Squid configuration.
4. Run:

```sh
squid -k parse
```

5. If parsing succeeds, back up the previous `/etc/squid/squid.conf` with a dated filename.
6. Copy the new config into place.
7. Reconfigure Squid.

The current implementation backs up only files whose content changes, using the format `filename.YYYYMMDD-HHMMSS.bak`.
This applies to the generated Squid config, the per-profile domain lists and the map files. If parsing fails, the helper stops and returns the full output to LuCI.

## SSH Workflows

### Inspect

```sh
uci show squid_profiles
```

### Edit with `uci`

```sh
uci set squid_profiles.@profile[0].name='kids'
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

## Notes for Maintainers

- The UCI file is the editable source.
- `/etc/squid/squid.conf` is generated output.
- Do not add a second, divergent config source.
- Keep validation in the helper, not only in the UI.
- Keep the list/full-text profile modes exclusive.
