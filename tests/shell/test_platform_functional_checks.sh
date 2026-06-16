#!/bin/sh

set -eu

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
CONTAINER="${CONTAINER:-openwrt-squid-profile-ui}"
USER="${TEST_PLATFORM_USER:-root}"
PASSWORD="${TEST_PLATFORM_PASSWORD:-admin}"
BACKUP="/tmp/squid_profiles.live-test.backup"
BASELINE="/tmp/squid_profiles.live-test.baseline"
RPC_ID=2
LAST_RPC_JSON=""

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

need_cmd() {
	command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

restore_container() {
	podman exec "$CONTAINER" sh -c '
		if [ -f /tmp/squid_profiles.live-test.backup ]; then
			cp /tmp/squid_profiles.live-test.backup /etc/config/squid_profiles
			uci commit squid_profiles >/dev/null 2>&1 || true
			/usr/libexec/squid-profiles apply >/tmp/squid-profiles-restore.out 2>&1 || true
			rm -f /tmp/squid_profiles.live-test.backup /tmp/squid_profiles.live-test.baseline
		fi
	' >/dev/null 2>&1 || true
}

rpc_exec() {
	action="$1"
	id="$2"
	curl --max-time 20 -fsS "$BASE_URL/ubus/" \
		-H 'Content-Type: application/json' \
		-d "{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"call\",\"params\":[\"$session\",\"file\",\"exec\",{\"command\":\"/usr/libexec/squid-profiles\",\"params\":[\"$action\"]}]}"
}

assert_rpc_success() {
	json="$1"
	label="$2"
	printf '%s' "$json" | grep -Eq '"code"[[:space:]]*:[[:space:]]*0' || {
		printf '%s\n' "$json" >&2
		fail "$label did not return code 0"
	}
	printf '%s' "$json" | grep -F -q 'squid mock parse OK' || {
		printf '%s\n' "$json" >&2
		fail "$label did not return Squid parse output"
	}
}

run_action() {
	action="$1"
	label="$2"
	LAST_RPC_JSON="$(rpc_exec "$action" "$RPC_ID")" || fail "$label RPC failed"
	RPC_ID=$((RPC_ID + 1))
	assert_rpc_success "$LAST_RPC_JSON" "$label"
}

rollback_to_baseline() {
	podman exec "$CONTAINER" sh -c "
		set -eu
		cp '$BASELINE' /etc/config/squid_profiles
		uci commit squid_profiles >/dev/null
		/usr/libexec/squid-profiles apply >/tmp/squid-profiles-rollback.out 2>&1
	" || {
		podman exec "$CONTAINER" cat /tmp/squid-profiles-rollback.out >&2 || true
		fail "rollback to test baseline failed"
	}
}

set_common_policy() {
	podman exec -i "$CONTAINER" sh -s <<'EOSH'
set -eu
cat > /etc/config/squid_profiles <<'EOCFG'
config globals 'core'
	option enabled '1'

config profile 'kids'
	option name 'kids'
	option description 'pc-dev policy'

config network 'lan'
	option cidr '192.168.31.0/24'
	option vlan 'LAN'
	option description 'pc-dev LAN coverage'

config vm 'pc_dev'
	option type 'vm'
	option ip '192.168.31.11'
	option name 'pc-dev'
	option vlan 'LAN'
	list profile 'kids'
EOCFG
uci commit squid_profiles
EOSH
}

set_text_rules() {
	allow_rule="$1"
	deny_rule="${2:-}"
	podman exec -i -e ALLOW_RULE="$allow_rule" -e DENY_RULE="$deny_rule" "$CONTAINER" sh -s <<'EOSH'
set -eu
uci set squid_profiles.kids.edit_mode='text'
uci -q delete squid_profiles.kids.allow_domain || true
uci -q delete squid_profiles.kids.deny_domain || true
if [ -n "$DENY_RULE" ]; then
	uci set squid_profiles.kids.raw_rules="allow $ALLOW_RULE
deny $DENY_RULE"
else
	uci set squid_profiles.kids.raw_rules="allow $ALLOW_RULE"
fi
uci commit squid_profiles
EOSH
}

set_list_rules() {
	allow_domain="$1"
	deny_domain="${2:-}"
	podman exec -i -e ALLOW_DOMAIN="$allow_domain" -e DENY_DOMAIN="$deny_domain" "$CONTAINER" sh -s <<'EOSH'
set -eu
uci set squid_profiles.kids.edit_mode='lists'
uci -q delete squid_profiles.kids.raw_rules || true
uci -q delete squid_profiles.kids.allow_domain || true
uci -q delete squid_profiles.kids.deny_domain || true
uci add_list squid_profiles.kids.allow_domain="$ALLOW_DOMAIN"
if [ -n "$DENY_DOMAIN" ]; then
	uci add_list squid_profiles.kids.deny_domain="$DENY_DOMAIN"
fi
uci commit squid_profiles
EOSH
}

assert_generated_files() {
	label="$1"
	expected_allow="$2"
	expected_deny="$3"
	unexpected="${4:-}"

	podman exec -i \
		-e LABEL="$label" \
		-e EXPECT_ALLOW="$expected_allow" \
		-e EXPECT_DENY="$expected_deny" \
		-e UNEXPECTED="$unexpected" \
		"$CONTAINER" sh -s <<'EOSH'
set -eu

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

assert_file_exact() {
	file="$1"
	expected="$2"
	[ -f "$file" ] || fail "$LABEL: missing file: $file"
	actual="$(cat "$file")"
	[ "$actual" = "$expected" ] || fail "$LABEL: unexpected content in $file: $actual"
}

assert_file_contains() {
	file="$1"
	needle="$2"
	grep -F -q "$needle" "$file" || fail "$LABEL: expected $file to contain: $needle"
}

assert_file_not_contains() {
	file="$1"
	needle="$2"
	if [ -f "$file" ] && grep -F -q "$needle" "$file"; then
		fail "$LABEL: unexpected $needle in $file"
	fi
}

assert_unexpected_domain() {
	needle="$1"
	if grep -x -F -q "$needle" /etc/squid/domains/*.txt; then
		grep -x -F "$needle" /etc/squid/domains/*.txt >&2 || true
		fail "$LABEL: unexpected generated domain line for $needle"
	fi
	if grep -F -q "$needle" /etc/squid/maps/10-profiles.conf; then
		grep -F "$needle" /etc/squid/maps/10-profiles.conf >&2 || true
		fail "$LABEL: unexpected generated map reference to $needle"
	fi
}

allow_file="/etc/squid/domains/kids.allow.txt"
deny_file="/etc/squid/domains/kids.deny.txt"
map="/etc/squid/maps/10-profiles.conf"

assert_file_exact "$allow_file" "$EXPECT_ALLOW"
assert_file_contains "$map" 'acl device_192_168_31_11 src 192.168.31.11'
assert_file_contains "$map" 'acl profile_kids_allow dstdomain "/etc/squid/domains/kids.allow.txt"'
assert_file_contains "$map" 'http_access allow device_192_168_31_11 profile_kids_allow'

if [ -n "$EXPECT_DENY" ]; then
	assert_file_exact "$deny_file" "$EXPECT_DENY"
	assert_file_contains "$map" 'acl profile_kids_deny dstdomain "/etc/squid/domains/kids.deny.txt"'
	assert_file_contains "$map" 'http_access deny device_192_168_31_11 profile_kids_deny'
	deny_line="$(grep -n 'http_access deny device_192_168_31_11 profile_kids_deny' "$map" | cut -d: -f1)"
	allow_line="$(grep -n 'http_access allow device_192_168_31_11 profile_kids_allow' "$map" | cut -d: -f1)"
	[ "$deny_line" -lt "$allow_line" ] || fail "$LABEL: device deny rule is not emitted before allow rule"
else
	[ ! -s "$deny_file" ] || fail "$LABEL: deny file should be empty"
	assert_file_not_contains "$map" 'profile_kids_deny'
fi

for needle in $UNEXPECTED; do
	assert_unexpected_domain "$needle"
done
EOSH
}

run_validate_apply_save() {
	label="$1"
	expected_allow="$2"
	expected_deny="$3"
	unexpected="${4:-}"

	run_action validate "$label validate action"
	run_action apply "$label apply action"
	printf '%s' "$LAST_RPC_JSON" | grep -F -q 'Restarted Squid service:' || {
		printf '%s\n' "$LAST_RPC_JSON" >&2
		fail "$label apply action did not restart Squid"
	}
	assert_generated_files "$label after apply" "$expected_allow" "$expected_deny" "$unexpected"

	podman exec -i "$CONTAINER" sh -s <<'EOSH'
set -eu
: > /tmp/squid-init-mock.log
: > /tmp/squid-mock.log
uci set squid_profiles.kids.description="save apply marker $(date +%s)"
uci commit squid_profiles
/etc/init.d/squid-profiles start >/tmp/squid-profiles-save-apply-start.out 2>&1
/sbin/reload_config
sleep 2
grep -F -q restart /tmp/squid-init-mock.log
grep -F -q -- '-k parse' /tmp/squid-mock.log
EOSH
	assert_generated_files "$label after save apply" "$expected_allow" "$expected_deny" "$unexpected"
}

run_text_scenario() {
	label="$1"
	allow_rule="$2"
	deny_rule="$3"
	expected_allow="$4"
	expected_deny="$5"
	unexpected="$6"

	rollback_to_baseline
	set_common_policy
	set_text_rules "$allow_rule" "$deny_rule"
	run_validate_apply_save "$label" "$expected_allow" "$expected_deny" "$unexpected"
	rollback_to_baseline
}

run_list_scenario() {
	label="$1"
	allow_domain="$2"
	deny_domain="$3"
	expected_allow="$4"
	expected_deny="$5"
	unexpected="$6"

	rollback_to_baseline
	set_common_policy
	set_list_rules "$allow_domain" "$deny_domain"
	run_validate_apply_save "$label" "$expected_allow" "$expected_deny" "$unexpected"
	rollback_to_baseline
}

run_full_text_to_list_update_scenario() {
	rollback_to_baseline
	set_common_policy
	set_text_rules '.toto.com' ''
	run_validate_apply_save 'full text setup .toto.com' '.toto.com' '' 'google.com de.toto.com'
	set_list_rules 'de.toto.com' ''
	run_validate_apply_save 'list update .toto.com to de.toto.com' 'de.toto.com' '' '.toto.com google.com'
	rollback_to_baseline
}

run_list_to_full_text_update_scenario() {
	rollback_to_baseline
	set_common_policy
	set_list_rules '.titi.com' ''
	run_validate_apply_save 'list setup .titi.com' '.titi.com' '' 'google.com de.titi.com'
	set_text_rules 'de.titi.com' ''
	run_validate_apply_save 'full text update .titi.com to de.titi.com' 'de.titi.com' '' '.titi.com google.com'
	rollback_to_baseline
}

run_invalid_apostrophe_check() {
	rollback_to_baseline
	set_common_policy
	set_list_rules "'.google.com" "'.google.com"

	podman exec -i "$CONTAINER" sh -s <<'EOSH'
set -eu
if /usr/libexec/squid-profiles validate >/tmp/squid-profiles-invalid.out 2>&1; then
	cat /tmp/squid-profiles-invalid.out >&2
	exit 1
fi
grep -F -q "invalid domain in profile kids allow list: '.google.com" /tmp/squid-profiles-invalid.out
EOSH
	rollback_to_baseline
}

need_cmd curl
need_cmd podman

podman ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -Fxq "$CONTAINER" || fail "container is not running: $CONTAINER"
podman exec "$CONTAINER" /etc/init.d/rpcd restart >/dev/null
trap restore_container EXIT HUP INT TERM

profiles_js="$(curl --max-time 5 -fsS "$BASE_URL/luci-static/resources/view/squid-profiles/profiles.js")" || fail "unable to fetch profiles.js from $BASE_URL"
printf '%s' "$profiles_js" | grep -F -q "fs.exec('/usr/libexec/squid-profiles'" || fail "served profiles.js does not use fs.exec"
if printf '%s' "$profiles_js" | grep -F -q "admin/services/squid-profiles/' + action"; then
	fail "served profiles.js still calls legacy Lua controller endpoints"
fi

login_json="$(curl --max-time 5 -fsS "$BASE_URL/ubus/" \
	-H 'Content-Type: application/json' \
	-d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"call\",\"params\":[\"00000000000000000000000000000000\",\"session\",\"login\",{\"username\":\"$USER\",\"password\":\"$PASSWORD\"}]}")" || fail "ubus login request failed"
session="$(printf '%s' "$login_json" | sed -n 's/.*"ubus_rpc_session"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
[ -n "$session" ] || fail "ubus login did not return a session"

podman exec -i "$CONTAINER" sh -s <<EOSH
set -eu
command -v squid >/dev/null 2>&1 || exit 1
cp /etc/config/squid_profiles "$BACKUP"
/etc/uci-defaults/90_squid_profiles >/tmp/squid-profiles-uci-defaults.out 2>&1
/etc/init.d/squid-profiles enabled >/dev/null 2>&1
/etc/init.d/squid-profiles start >/tmp/squid-profiles-start.out 2>&1
cat > /etc/config/squid_profiles <<'EOCFG'
config globals 'core'
	option enabled '1'
EOCFG
uci commit squid_profiles
cp /etc/config/squid_profiles "$BASELINE"
EOSH

run_text_scenario 'pc-dev kids text wildcard and deny' '*.kk.com' '.voila.com' '.kk.com' '.voila.com' 'google.com'
run_list_scenario 'pc-dev kids list allow .toto.com' '.toto.com' '' '.toto.com' '' 'google.com de.toto.com .titt.com'
run_list_scenario 'pc-dev kids list allow .titt.com' '.titt.com' '' '.titt.com' '' 'google.com de.titt.com .toto.com'
run_full_text_to_list_update_scenario
run_list_to_full_text_update_scenario
run_invalid_apostrophe_check

printf 'test-platform functional checks passed\n'
