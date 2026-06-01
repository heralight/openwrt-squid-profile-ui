include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-squid-profiles
PKG_VERSION:=0.1.0
PKG_RELEASE:=2

PKG_LICENSE:=BSD-2-Clause
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Alexandre Richonnier
PKGARCH:=all

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-squid-profiles
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI Squid profile manager
  URL:=https://github.com/heralight/openwrt-squid-profile-ui
  MAINTAINER:=Alexandre Richonnier
  DEPENDS:=+luci-base +luci-compat +luci-lua-runtime +rpcd +uci +squid
  PKGARCH:=all
endef

define Package/luci-app-squid-profiles/description
 LuCI application for managing Squid proxy profiles by IP address,
 LAN/VLAN network and detected OpenWrt devices.
endef

define Package/luci-app-squid-profiles/conffiles
/etc/config/squid_profiles
endef

define Build/Compile
endef

define Package/luci-app-squid-profiles/install
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) files/usr/share/luci/menu.d/*.json $(1)/usr/share/luci/menu.d

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) files/usr/share/rpcd/acl.d/*.json $(1)/usr/share/rpcd/acl.d

	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(INSTALL_DATA) files/usr/lib/lua/luci/controller/*.lua $(1)/usr/lib/lua/luci/controller

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/squid-profiles
	$(INSTALL_DATA) files/www/luci-static/resources/view/squid-profiles/*.js \
		$(1)/www/luci-static/resources/view/squid-profiles

	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) files/usr/libexec/squid-profiles $(1)/usr/libexec/squid-profiles

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) files/etc/config/squid_profiles $(1)/etc/config/squid_profiles

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) files/etc/uci-defaults/* $(1)/etc/uci-defaults

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) files/etc/init.d/* $(1)/etc/init.d
endef

$(eval $(call BuildPackage,luci-app-squid-profiles))
