#!/bin/bash
#
# Script that prints out active network interfaces' IP and MAC addresses
#
# Donald Burr <dburr@vctlabs.com>

if ip a | grep -Eq ': eth0:.*state UP'; then
  eth_ip=$(ip addr | awk '/inet/ && /eth0/{sub(/\/.*$/,"",$2); print $2}')
  eth_mac=`ifconfig eth0 | grep -o -E '([[:xdigit:]]{1,2}:){5}[[:xdigit:]]{1,2}'`
  echo "ethernet: IP=$eth_ip  MAC=$eth_mac"
fi
if ip a | grep -Eq ': wlan0:.*state UP'; then
  wifi_ip=$(ip addr | awk '/inet/ && /wlan0/{sub(/\/.*$/,"",$2); print $2}')
  wifi_mac=`ifconfig wlan0 | grep -o -E '([[:xdigit:]]{1,2}:){5}[[:xdigit:]]{1,2}'`
  echo "    wifi: IP=$wifi_ip  MAC=$wifi_mac"
fi
