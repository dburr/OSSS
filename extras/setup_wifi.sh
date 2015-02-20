#!/bin/bash
#
# Raspberry Pi Setup Script
# Donald Burr <dburr@vctlabs.com>

D="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

if grep -q raspberrypi /etc/hostname; then
  echo "You still have the default hostname set."
  echo "If you wish to change it, enter a new hostname now, otherwise"
  echo -n "just press Return: "
  read NEW_HOSTNAME
  if [ ! -z "$NEW_HOSTNAME" ]; then
    echo "$NEW_HOSTNAME" > /tmp/HOSTNAME.$$
    sudo rm -f /etc/hostname
    sudo mv /tmp/HOSTNAME.$$ /etc/hostname
    sudo chown root:root /etc/hostname
    sudo chmod 644 /etc/hostname
    sudo /etc/init.d/hostname.sh
  fi
fi

echo -n "Enter your wireless network's SSID: "
read SSID
PASSWORD="foo"
PASSWORD_TEMP="bar"
stty -echo
while [ "$PASSWORD" != "$PASSWORD_TEMP" ]; do
  echo -n "Enter your wireless network's password (WPA/WPA2 only): "
  read PASSWORD
  echo
  echo -n "Re-enter for verification: "
  read PASSWORD_TEMP
  echo
  if [ "$PASSWORD" != "$PASSWORD_TEMP" ]; then
    echo "Error: passwords do not match"
  fi
done
stty echo
if [ -f /etc/network/interfaces ]; then
  sudo mv -f /etc/network/interfaces /etc/network/interfaces.bak
fi
sudo cp $D/interfaces.wifi /etc/network/interfaces
sudo chown root:root /etc/network/interfaces
sudo chmod 644 /etc/network/interfaces
if [ -f /etc/wpa_supplicant/wpa_supplicant.conf ]; then
  sudo mv -f /etc/wpa_supplicant/wpa_supplicant.conf /etc/wpa_supplicant/wpa_supplicant.conf.bak
fi
sudo cp $D/wpa_supplicant.conf /etc/wpa_supplicant/wpa_supplicant.conf
sudo sed -i.sed.bak -e "s/#SSID#/$SSID/g" -e "s/#PASSWORD#/$PASSWORD/g" /etc/wpa_supplicant/wpa_supplicant.conf
sudo chown root:root /etc/wpa_supplicant/wpa_supplicant.conf
sudo chmod 600 /etc/wpa_supplicant/wpa_supplicant.conf
echo "*** attempting to bring up wifi... ***"
sudo ifdown wlan0
sudo ifup wlan0
