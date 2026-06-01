/*
 * Squid profiles – network management page
 *
 * This view allows the administrator to define which subnets are
 * controlled by Squid and to assign VLAN identifiers to each network.
 * Only machines within these subnets can be assigned to profiles on
 * the Devices page.  Changes are validated with `squid -k parse` before
 * being committed and Squid is reconfigured automatically when
 * requested.
 */

'use strict';

var view    = require('view');
var form    = require('form');
var uci     = require('uci');
var request = require('request');
var ui      = require('ui');

return view.extend({
    load: function() {
        return uci.load('squid_profiles');
    },

    render: function() {
        var self = this;
        var m = new form.Map('squid_profiles', _('Squid Profiles - Networks'), _('Define the networks and VLANs governed by Squid.  Only machines within these subnets can be assigned to profiles.'));

        var s = m.section(form.GridSection, 'network', _('Networks'));
        s.nodescriptions = true;
        s.addremove = true;
        s.anonymous = false;

        // Subnet (CIDR)
        var subnetOpt = s.option(form.Value, 'subnet', _('Subnet (CIDR)'));
        subnetOpt.datatype = 'cidr4';
        subnetOpt.placeholder = '192.168.1.0/24';

        // VLAN ID
        var vlanOpt = s.option(form.Value, 'vlan', _('VLAN'));
        vlanOpt.datatype = 'uinteger';
        vlanOpt.placeholder = '1';

        // Footer actions: validate and apply
        s.renderMore = function() {
            var btns = E('div', { 'class': 'cbi-section-actions' }, [
                E('button', {
                    'class': 'cbi-button cbi-button-apply',
                    'click': function(ev) {
                        ev.preventDefault();
                        return self._validateConfig(true);
                    }
                }, [ _('Validate') ]),
                E('button', {
                    'class': 'cbi-button cbi-button-save',
                    'click': function(ev) {
                        ev.preventDefault();
                        return self._applyConfig();
                    }
                }, [ _('Apply') ])
            ]);
            return btns;
        };

        this._validateConfig = function(showToast) {
            return uci.save().then(function() {
                return request.get('/cgi-bin/luci/admin/services/squid-profiles/parse', { timeout: 10000 });
            }).then(function(res) {
                var data = (res || {}).json || {};
                if (data.success) {
                    if (showToast)
                        ui.addNotification(null, E('p', {}, _('Squid configuration validated successfully.')), 'info');
                    return true;
                }
                ui.addNotification(null, E('p', {}, [_('Validation failed: '), data.message || _('Unknown error')]), 'error');
                return false;
            }).catch(function(err) {
                ui.addNotification(null, E('p', {}, _('Validation request failed.')), 'error');
                return false;
            });
        };

        this._applyConfig = function() {
            var self = this;
            return self._validateConfig(false).then(function(ok) {
                if (!ok)
                    return;
                return uci.save().then(function() {
                    return uci.commit('squid_profiles');
                }).then(function() {
                    return request.get('/cgi-bin/luci/admin/services/squid-profiles/reload', { timeout: 15000 });
                }).then(function(res) {
                    var data = (res || {}).json || {};
                    if (data.success) {
                        ui.addNotification(null, E('p', {}, _('Changes applied and Squid reloaded successfully.')), 'info');
                    }
                    else {
                        ui.addNotification(null, E('p', {}, [_('Failed to reload Squid: '), data.message || _('Unknown error')]), 'error');
                    }
                }).catch(function(err) {
                    ui.addNotification(null, E('p', {}, _('Failed to apply changes.')), 'error');
                });
            });
        };

        return m.render();
    }
});