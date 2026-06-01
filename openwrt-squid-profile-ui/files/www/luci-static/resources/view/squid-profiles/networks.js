'use strict';

var view = require('view');
var form = require('form');
var uci = require('uci');
var request = require('request');
var ui = require('ui');

function notifyResult(title, data, level) {
    ui.addNotification(null, E('div', {}, [
        E('p', {}, [ title ]),
        data && data.output ? E('pre', { 'style': 'white-space:pre-wrap' }, [ data.output ]) : ''
    ]), level || 'info');
}

function callAction(action) {
    return request.get('/cgi-bin/luci/admin/services/squid-profiles/' + action, { timeout: 20000 }).then(function(res) {
        return (res || {}).json || {};
    });
}

return view.extend({
    load: function() {
        return uci.load('squid_profiles');
    },

    render: function() {
        var m = new form.Map('squid_profiles', _('Squid Profiles - Networks'), _('Define IPv4 networks covered by Squid and their VLAN or LAN label.'));

        var s = m.section(form.GridSection, 'network', _('Covered networks'));
        s.anonymous = false;
        s.addremove = true;
        s.nodescriptions = true;

        var cidr = s.option(form.Value, 'cidr', _('IPv4 CIDR'));
        cidr.rmempty = false;
        cidr.datatype = 'cidr4';
        cidr.placeholder = '192.168.31.0/24';

        var vlan = s.option(form.Value, 'vlan', _('VLAN/LAN'));
        vlan.rmempty = false;
        vlan.placeholder = 'VLAN 31';

        var description = s.option(form.Value, 'description', _('Description'));
        description.rmempty = true;

        var actions = m.section(form.NamedSection, 'core', 'globals', _('Actions'));
        actions.addremove = false;

        var validate = actions.option(form.Button, '_validate', _('Validate configuration'));
        validate.inputstyle = 'apply';
        validate.onclick = function() {
            return uci.save().then(function() { return callAction('parse'); }).then(function(data) {
                notifyResult(data.success ? _('Validation succeeded') : _('Validation failed'), data, data.success ? 'info' : 'error');
            });
        };

        var apply = actions.option(form.Button, '_apply', _('Apply'));
        apply.inputstyle = 'save';
        apply.onclick = function() {
            return uci.save().then(function() { return uci.commit('squid_profiles'); }).then(function() {
                return callAction('apply');
            }).then(function(data) {
                notifyResult(data.success ? _('Configuration applied') : _('Apply failed'), data, data.success ? 'info' : 'error');
            });
        };

        return m.render();
    }
});
