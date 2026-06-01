FROM openwrt/rootfs:x86-64-24.10.7

RUN mkdir -p /var/lock /var/run /tmp/opkg-lists && \
    opkg update && \
    opkg install uhttpd rpcd luci-base luci-mod-admin-full luci-mod-network luci-mod-system luci-theme-bootstrap squid openssh-server && \
    /etc/init.d/uhttpd enable && \
    /etc/init.d/rpcd enable || true

EXPOSE 80 22 3128

CMD ["/sbin/init"]
