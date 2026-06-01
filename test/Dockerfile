# Utilise le rootfs officiel comme base (remplacez la balise par celle qui vous intéresse)
FROM openwrt/rootfs:x86-64-24.10.7

# Mettez à jour les listes de paquets et installez LuCI, uhttpd et Squid
RUN mkdir -p /var/lock && \
    opkg update && \
    opkg install uhttpd luci-base luci-mod-admin-full luci-mod-network \
                 luci-mod-system luci-theme-bootstrap squid

# # Copiez votre paquet IPK dans l'image pour pouvoir l'installer
# # (remplacez le nom du fichier selon votre version)
# COPY luci-app-squid-profiles_*.ipk /tmp/

# # Installez votre plugin
# RUN opkg install /tmp/luci-app-squid-profiles_*.ipk && rm /tmp/luci-app-squid-profiles_*.ipk

# Par défaut, OpenWrt démarre avec /sbin/init
CMD ["/sbin/init"]
