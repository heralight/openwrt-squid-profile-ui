#!/bin/sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
HELPER="$ROOT/openwrt-squid-profile-ui/files/usr/libexec/squid-profiles"
BASE_PATH="$PATH"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/squid-profiles-tests.XXXXXX")"
LAST_OUTPUT=""

cleanup() {
	rm -rf "$TMP_ROOT"
}

trap cleanup EXIT HUP INT TERM

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

assert_contains() {
	haystack="$1"
	needle="$2"
	printf '%s' "$haystack" | grep -F -q -- "$needle" || fail "expected output to contain: $needle"
}

assert_file_contains() {
	file="$1"
	needle="$2"
	[ -f "$file" ] || fail "missing file: $file"
	grep -F -q -- "$needle" "$file" || fail "expected $file to contain: $needle"
}

assert_file_not_contains() {
	file="$1"
	needle="$2"
	[ -f "$file" ] || fail "missing file: $file"
	if grep -F -q -- "$needle" "$file"; then
		fail "did not expect $file to contain: $needle"
	fi
}

setup_case() {
	name="$1"
	CASE_DIR="$TMP_ROOT/$name"
	MOCK_BIN="$CASE_DIR/bin"
	UCI_MOCK_FILE="$CASE_DIR/uci.db"
	SQUID_MOCK_LOG="$CASE_DIR/squid.log"
	INIT_MOCK_LOG="$CASE_DIR/init.log"
	SQUID_DIR="$CASE_DIR/etc-squid"
	SQUID_CONF="$SQUID_DIR/squid.conf"
	SQUID_INIT="$CASE_DIR/init.d/squid"
	PATH="$MOCK_BIN:$BASE_PATH"

	export UCI_MOCK_FILE SQUID_MOCK_LOG INIT_MOCK_LOG SQUID_DIR SQUID_CONF SQUID_INIT PATH
	mkdir -p "$MOCK_BIN" "$SQUID_DIR" "$CASE_DIR/init.d"
	: > "$SQUID_MOCK_LOG"
	: > "$INIT_MOCK_LOG"

	cat > "$MOCK_BIN/uci" <<'EOUCI'
#!/bin/sh
if [ "${1:-}" = "-q" ]; then
	shift
fi
cmd="${1:-}"
[ "$#" -gt 0 ] && shift
db="${UCI_MOCK_FILE:?}"

case "$cmd" in
	show)
		config="${1:-}"
		[ -f "$db" ] || exit 1
		sed -n "/^$config\./p" "$db"
	;;
	get)
		key="${1:-}"
		[ -f "$db" ] || exit 1
		line="$(grep -F "$key=" "$db" | tail -n 1 || true)"
		[ -n "$line" ] || exit 1
		value="${line#*=}"
		printf '%b\n' "$value"
	;;
	set)
		exit 0
	;;
	commit)
		exit 0
	;;
	delete)
		exit 0
	;;
	batch)
		while IFS= read -r _line; do :; done
		exit 0
	;;
	*)
		exit 1
	;;
esac
EOUCI
	chmod +x "$MOCK_BIN/uci"

	cat > "$MOCK_BIN/squid" <<'EOSQUID'
#!/bin/sh
printf '%s\n' "$*" >> "${SQUID_MOCK_LOG:?}"
config=""
parse=0
while [ "$#" -gt 0 ]; do
	case "$1" in
		-f)
			config="$2"
			shift 2
		;;
		-k)
			[ "${2:-}" = "parse" ] && parse=1
			shift 2
		;;
		*)
			shift
		;;
	esac
done

if [ "$parse" -eq 1 ]; then
	[ -n "$config" ] && [ -f "$config" ] || { echo "missing config: $config" >&2; exit 1; }
	include="$(sed -n 's/^include //p' "$config" | tail -n 1)"
	printf 'include:%s\n' "$include" >> "${SQUID_MOCK_LOG:?}"
	[ -z "$include" ] || [ -f "$include" ] || { echo "missing include: $include" >&2; exit 1; }
	if [ -n "$include" ]; then
		sed -n 's/.*dstdomain "\(.*\)".*/\1/p' "$include" | while IFS= read -r domain_file; do
			[ -f "$domain_file" ] || { echo "missing domain file: $domain_file" >&2; exit 1; }
			if grep -q "'" "$domain_file"; then
				echo "invalid apostrophe in domain file: $domain_file" >&2
				exit 1
			fi
		done
	fi
	echo "squid parse ok: $config"
	exit 0
fi

echo "squid runtime ok"
exit 0
EOSQUID
	chmod +x "$MOCK_BIN/squid"

	cat > "$SQUID_INIT" <<'EOINIT'
#!/bin/sh
printf '%s\n' "$*" >> "${INIT_MOCK_LOG:?}"
exit 0
EOINIT
	chmod +x "$SQUID_INIT"
}

run_ok() {
	LAST_OUTPUT="$("$HELPER" "$@" 2>&1)" || fail "helper failed unexpectedly for $*: $LAST_OUTPUT"
}

run_fail() {
	set +e
	LAST_OUTPUT="$("$HELPER" "$@" 2>&1)"
	status=$?
	set -e
	[ "$status" -ne 0 ] || fail "helper succeeded unexpectedly for $*"
}

write_common_valid_config() {
	cat > "$UCI_MOCK_FILE" <<'EOF'
squid_profiles.core=globals
squid_profiles.core.enabled=1
squid_profiles.kids=profile
squid_profiles.kids.name=kids
squid_profiles.kids.edit_mode=text
squid_profiles.kids.raw_rules=allow .allowed.example\ndeny .google.com
squid_profiles.kids.allow_domain=.stale-allow.example
squid_profiles.kids.deny_domain=.stale-deny.example
squid_profiles.empty=profile
squid_profiles.empty.name=empty
squid_profiles.empty.edit_mode=lists
squid_profiles.lan=network
squid_profiles.lan.cidr=192.168.1.42/24
squid_profiles.lan.vlan=LAN
squid_profiles.lan.profile=kids empty
squid_profiles.vm1=vm
squid_profiles.vm1.ip=192.168.1.10
squid_profiles.vm1.profile=kids empty
squid_profiles.vm2=vm
squid_profiles.vm2.ip=192.168.1.11
squid_profiles.vm2.profile=empty
EOF
}

test_invalid_apostrophe_domain_fails_validation() {
	setup_case invalid-apostrophe
	cat > "$UCI_MOCK_FILE" <<'EOF'
squid_profiles.core=globals
squid_profiles.core.enabled=1
squid_profiles.bad=profile
squid_profiles.bad.name=bad
squid_profiles.bad.edit_mode=lists
squid_profiles.bad.allow_domain='.google.com
squid_profiles.bad.deny_domain='.google.com
squid_profiles.lan=network
squid_profiles.lan.cidr=192.168.1.0/24
squid_profiles.lan.vlan=LAN
squid_profiles.lan.profile=bad
EOF

	run_fail validate
	assert_contains "$LAST_OUTPUT" "invalid domain in profile bad allow list: '.google.com"
	[ ! -s "$INIT_MOCK_LOG" ] || fail "validate must not restart Squid"
}

test_validate_uses_staged_generated_map() {
	setup_case validate-staging
	write_common_valid_config

	run_ok validate
	assert_file_contains "$SQUID_MOCK_LOG" "include:/tmp/squid-profiles."
	assert_contains "$LAST_OUTPUT" "squid parse ok: /tmp/squid-profiles.squid.conf"
}

test_text_mode_raw_rules_are_source_of_truth() {
	setup_case text-source
	write_common_valid_config

	run_ok apply
	assert_file_contains "$SQUID_DIR/domains/kids.allow.txt" ".allowed.example"
	assert_file_contains "$SQUID_DIR/domains/kids.deny.txt" ".google.com"
	assert_file_not_contains "$SQUID_DIR/domains/kids.allow.txt" ".stale-allow.example"
	assert_file_not_contains "$SQUID_DIR/domains/kids.deny.txt" ".stale-deny.example"
}

test_apply_restarts_squid_service_after_parse() {
	setup_case apply-restart
	write_common_valid_config

	run_ok apply
	assert_file_contains "$INIT_MOCK_LOG" "restart"
	assert_file_contains "$SQUID_MOCK_LOG" "-k parse"
	assert_contains "$LAST_OUTPUT" "Restarted Squid service:"
}

test_invalid_apply_does_not_restart_squid() {
	setup_case invalid-apply
	cat > "$UCI_MOCK_FILE" <<'EOF'
squid_profiles.core=globals
squid_profiles.core.enabled=1
squid_profiles.bad=profile
squid_profiles.bad.name=bad
squid_profiles.bad.edit_mode=lists
squid_profiles.bad.allow_domain='.google.com
squid_profiles.lan=network
squid_profiles.lan.cidr=192.168.1.0/24
squid_profiles.lan.vlan=LAN
squid_profiles.lan.profile=bad
EOF

	run_fail apply
	[ ! -s "$INIT_MOCK_LOG" ] || fail "invalid apply must not restart Squid"
}

test_generated_squid_rules_block_denied_domains_before_allows() {
	setup_case generated-blocking
	write_common_valid_config

	run_ok apply
	map="$SQUID_DIR/maps/10-profiles.conf"
	assert_file_contains "$map" "acl squid_profiles_net_lan src 192.168.1.0/24"
	assert_file_contains "$map" "acl profile_kids_deny dstdomain \"$SQUID_DIR/domains/kids.deny.txt\""
	assert_file_contains "$map" "http_access deny squid_profiles_net_lan profile_kids_deny"
	assert_file_contains "$map" "http_access allow squid_profiles_net_lan profile_kids_allow"
	deny_line="$(grep -n 'http_access deny squid_profiles_net_lan profile_kids_deny' "$map" | cut -d: -f1)"
	allow_line="$(grep -n 'http_access allow squid_profiles_net_lan profile_kids_allow' "$map" | cut -d: -f1)"
	[ "$deny_line" -lt "$allow_line" ] || fail "deny rule must be emitted before allow rule"
}

test_invalid_apostrophe_domain_fails_validation
test_validate_uses_staged_generated_map
test_text_mode_raw_rules_are_source_of_truth
test_apply_restarts_squid_service_after_parse
test_invalid_apply_does_not_restart_squid
test_generated_squid_rules_block_denied_domains_before_allows

printf 'helper functional tests passed\n'
