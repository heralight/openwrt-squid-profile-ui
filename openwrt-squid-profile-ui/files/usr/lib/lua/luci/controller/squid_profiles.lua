-- SPDX-License-Identifier: Apache-2.0

module("luci.controller.squid_profiles", package.seeall)

local helper = "/usr/libexec/squid-profiles"

function index()
	entry({"admin", "services", "squid-profiles", "init"}, call("action_init"), nil, 79).leaf = true
	entry({"admin", "services", "squid-profiles", "parse"}, call("action_parse"), nil, 80).leaf = true
	entry({"admin", "services", "squid-profiles", "validate"}, call("action_validate"), nil, 80).leaf = true
	entry({"admin", "services", "squid-profiles", "apply"}, call("action_apply"), nil, 81).leaf = true
end

local function json_result(ok, code, output)
	local http = require "luci.http"
	http.prepare_content("application/json")
	http.write_json({
		success = ok,
		code = code,
		message = output or "",
		output = output or ""
	})
end

local function run_helper(action)
	local sys = require "luci.sys"
	local cmd = string.format("%s %s 2>&1; echo __EXIT_CODE__:$?", helper, action)
	local output = sys.exec(cmd) or ""
	local code = tonumber(output:match("__EXIT_CODE__:(%d+)%s*$") or "1") or 1
	output = output:gsub("\n?__EXIT_CODE__:%d+%s*$", "")
	json_result(code == 0, code, output)
end

function action_init()
	run_helper("init")
end

function action_parse()
	run_helper("validate")
end

function action_validate()
	run_helper("validate")
end

function action_apply()
	run_helper("apply")
end
