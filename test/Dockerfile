FROM openwrt/rootfs:x86-64-24.10.7

RUN mkdir -p /var/lock /var/run /tmp/opkg-lists && \
    opkg update && \
    opkg install uhttpd rpcd luci-base luci-compat luci-lua-runtime uhttpd-mod-lua uhttpd-mod-ucode luci-mod-admin-full luci-mod-network luci-mod-system luci-theme-bootstrap squid openssh-server && \
    /etc/init.d/uhttpd enable && \
    /etc/init.d/rpcd enable && \
    mkdir -p /rom && \
    cp -a /etc/config /rom/etc-config-defaults || true

COPY entrypoint.sh /usr/local/bin/openwrt-test-entrypoint

RUN chmod +x /usr/local/bin/openwrt-test-entrypoint

EXPOSE 80 22 3128

CMD ["/usr/local/bin/openwrt-test-entrypoint"]
