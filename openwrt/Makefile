include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-squid-profiles
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=OpenAI Assistant <root@localhost>
PKG_LICENSE:=Apache-2.0

LUCI_TITLE:=Squid Profiles UI
LUCI_DESCRIPTION:=LuCI application for managing Squid proxy profiles by IP and VLAN.
LUCI_DEPENDS:=+luci-base +luci-compat +rpcd +uci

include $(INCLUDE_DIR)/luci.mk
include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)/install
    $(INSTALL_DIR) $(1)/usr/share/luci/menu.d
    $(INSTALL_DATA) files/usr/share/luci/menu.d/*.json $(1)/usr/share/luci/menu.d

    $(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
    $(INSTALL_DATA) files/usr/share/rpcd/acl.d/*.json $(1)/usr/share/rpcd/acl.d

    $(INSTALL_DIR) $(1)/usr/share/luci/controller
    $(INSTALL_DATA) files/usr/share/luci/controller/*.lua $(1)/usr/share/luci/controller

    $(INSTALL_DIR) $(1)/usr/share/luci/htdocs/luci-static/resources/view/squid-profiles
    $(INSTALL_DATA) files/usr/share/luci/htdocs/luci-static/resources/view/squid-profiles/*.js \
        $(1)/usr/share/luci/htdocs/luci-static/resources/view/squid-profiles

    $(INSTALL_DIR) $(1)/etc/uci-defaults
    $(INSTALL_BIN) files/etc/uci-defaults/* $(1)/etc/uci-defaults
endef

$(eval $(call BuildPackage,$(PKG_NAME)))