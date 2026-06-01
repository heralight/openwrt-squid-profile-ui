-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026

module("luci.controller.squid_profiles", package.seeall)

function index()
    -- The menu entries for this app are defined in a JSON menu file under
    -- usr/share/luci/menu.d.  We register RPC actions here.
    entry({"admin", "services", "squid-profiles", "parse"}, call("action_parse"), nil, 80).leaf = true
    entry({"admin", "services", "squid-profiles", "reload"}, call("action_reload"), nil, 81).leaf = true
end

-- Run squid -k parse and return JSON result
function action_parse()
    local http  = require "luci.http"
    local util  = require "luci.util"

    local cmd = "/usr/sbin/squid -k parse 2>&1"
    local result = {}
    local data = luci.sys.exec(cmd)
    -- os.execute returns the exit status in a shell-specific way; use sys.exec for output
    -- assume non-empty output implies error
    if data and #data > 0 then
        result.code = 1
        result.message = data
    else
        result.code = 0
        result.message = "Configuration parsed successfully"
    end
    http.prepare_content("application/json")
    http.write_json(result)
end

-- Reload squid configuration
function action_reload()
    local http = require "luci.http"
    local result = {}
    local cmd = "/usr/sbin/squid -k reconfigure 2>&1"
    local data = luci.sys.exec(cmd)
    if data and #data > 0 then
        result.code = 1
        result.message = data
    else
        result.code = 0
        result.message = "Squid reconfigured"
    end
    http.prepare_content("application/json")
    http.write_json(result)
end