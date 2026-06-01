'use strict';

var view = require('view');
var form = require('form');
var uci = require('uci');
var request = require('request');
var ui = require('ui');

function splitText(value) {
    return String(value || '').split(/[\s,]+/).filter(function(item) { return item; });
}

function isDomain(value) {
    return /^(\*\.)?[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(value || '') && value.indexOf('..') < 0;
}

function validateDomainSet(sectionId) {
    var allow = [];
    var deny = [];
    allow = allow.concat(uci.get('squid_profiles', sectionId, 'allow_domain') || []);
    deny = deny.concat(uci.get('squid_profiles', sectionId, 'deny_domain') || []);
    allow = allow.concat(splitText(uci.get('squid_profiles', sectionId, 'allow_text')));
    deny = deny.concat(splitText(uci.get('squid_profiles', sectionId, 'deny_text')));

    var seenAllow = {};
    var seenDeny = {};
    for (var i = 0; i < allow.length; i++) {
        if (!isDomain(allow[i]))
            return _('Invalid allowed domain: ') + allow[i];
        if (seenAllow[allow[i]])
            return _('Duplicate allowed domain: ') + allow[i];
        seenAllow[allow[i]] = true;
    }
    for (var j = 0; j < deny.length; j++) {
        if (!isDomain(deny[j]))
            return _('Invalid denied domain: ') + deny[j];
        if (seenDeny[deny[j]])
            return _('Duplicate denied domain: ') + deny[j];
        if (seenAllow[deny[j]])
            return _('Domain is both allowed and denied: ') + deny[j];
        seenDeny[deny[j]] = true;
    }
    return null;
}

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
        var m = new form.Map('squid_profiles', _('Squid Profiles - Profiles'), _('Create and edit Squid profiles with dynamic lists or full text domain input.'));

        var s = m.section(form.TypedSection, 'profile', _('Profiles'));
        s.anonymous = false;
        s.addremove = true;
        s.nodescriptions = true;

        var name = s.option(form.Value, 'name', _('Name'));
        name.rmempty = false;
        name.datatype = 'uciname';

        var description = s.option(form.Value, 'description', _('Description'));
        description.rmempty = true;

        var allow = s.option(form.DynamicList, 'allow_domain', _('Allowed domains'));
        allow.validate = function(sectionId, value) {
            if (!value)
                return true;
            return isDomain(value) ? true : _('Invalid domain name');
        };

        var deny = s.option(form.DynamicList, 'deny_domain', _('Denied domains'));
        deny.validate = function(sectionId, value) {
            if (!value)
                return true;
            return isDomain(value) ? true : _('Invalid domain name');
        };

        var allowText = s.option(form.TextValue, 'allow_text', _('Allowed domains - full text'));
        allowText.rows = 6;
        allowText.monospace = true;
        allowText.validate = function(sectionId, value) {
            var domains = splitText(value);
            for (var i = 0; i < domains.length; i++) {
                if (!isDomain(domains[i]))
                    return _('Invalid domain name: ') + domains[i];
            }
            return true;
        };

        var denyText = s.option(form.TextValue, 'deny_text', _('Denied domains - full text'));
        denyText.rows = 6;
        denyText.monospace = true;
        denyText.validate = allowText.validate;

        var validateProfile = s.option(form.Button, '_validate_profile', _('Validate this profile'));
        validateProfile.inputstyle = 'apply';
        validateProfile.onclick = function(sectionId) {
            var error = validateDomainSet(sectionId);
            if (error) {
                ui.addNotification(null, E('p', {}, [ error ]), 'error');
                return Promise.resolve();
            }
            return uci.save().then(function() { return callAction('parse'); }).then(function(data) {
                notifyResult(data.success ? _('Profile validation succeeded') : _('Profile validation failed'), data, data.success ? 'info' : 'error');
            });
        };

        var applyProfile = s.option(form.Button, '_apply_profile', _('Apply this profile'));
        applyProfile.inputstyle = 'save';
        applyProfile.onclick = function(sectionId) {
            var error = validateDomainSet(sectionId);
            if (error) {
                ui.addNotification(null, E('p', {}, [ error ]), 'error');
                return Promise.resolve();
            }
            return uci.save().then(function() { return uci.commit('squid_profiles'); }).then(function() {
                return callAction('apply');
            }).then(function(data) {
                notifyResult(data.success ? _('Profile applied') : _('Profile apply failed'), data, data.success ? 'info' : 'error');
            });
        };

        return m.render();
    }
});
