#!/bin/bash
#
# Raspberry Pi Setup Script
# Donald Burr <dburr@vctlabs.com>

# store location that this script is in
D="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# convenience function, install a package but only if it isn't already present
function install_package
{
  local PACKAGE=$1
  if dpkg -s $PACKAGE >/dev/null 2>&1; then
    echo "skipping install of $PACKAGE, it is already present"
  else
    echo "installing $PACKAGE"
    sudo aptitude -q=2 -y install $PACKAGE
  fi
}

# ffmpeg setup code is broken out into its own function because it
# is used in 2 spots in this script
function install_ffmpeg
{
  if [ "$DEBUG" = "YES" ]; then
    echo "skipping install of ffmpeg, we are in DEBUG Mode"
    echo "NOTE: this may break other apps that depend on it."
  elif hash ffserver 2>/dev/null; then
    echo "skipping install of ffmpeg, it is already present"
  else
    echo "*** building current ffmpeg from source ***"
    mkdir $HOME/src
    cd $HOME/src
    git clone git://source.ffmpeg.org/ffmpeg.git
    cd ffmpeg
    if [ "$INSTALL_FFMPEG_IN_USR" = "YES" ]; then
      ./configure --prefix=/usr
    else
      ./configure
    fi
    make
    sudo make install
    echo "*** setting up symlinks ***"
    if [ "$INSTALL_FFMPEG_IN_USR" != "YES" ]; then
      for COMMAND in ffmpeg ffprobe ffserver; do
        sudo rm -f /usr/bin/$COMMAND && sudo ln -sf ../local/bin/$COMMAND /usr/bin/$COMMAND
      done
    fi
  fi
}

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

echo "*** installing some prerequisite packages ***"
for PKG in cifs-utils git pv; do
  install_package $PKG
done

echo "*** setting up avahi (bonjour/autodiscovery) ***"
for PKG in avahi-daemon avahi-utils; do
  install_package $PKG
done
for F in $D/*.service; do
  echo "installing $F..."
  sudo cp $F /etc/avahi/services
done
sudo chown root:root /etc/avahi/services/*.service
sudo chmod 644 /etc/avahi/services/*.service
sudo service avahi-daemon restart

# set up osss
echo "*** setting up motion ***"
for PKG in motion; do
   install_package $PKG
done
if [ ! -f /etc/motion/motion.conf.orig ]; then
  echo "*** installing motion config file ***"
  sudo mv /etc/motion/motion.conf /etc/motion/motion.conf.orig
  sudo cp $D/motion.conf /etc/motion/motion.conf
  sudo sed -i.sed.bak "s/^.*\btext_left\b.*$/text_left `hostname`/" /etc/motion/motion.conf
  sudo chown root:motion /etc/motion/motion.conf
  sudo chmod 644 /etc/motion/motion.conf
fi
if ! grep -q bcm2835-v4l2 /etc/modules; then
  echo "*** setting camera driver to load at boot (and loading it now) ***"
  sudo sed -i.bak -e "\$a\
bcm2835-v4l2" /etc/modules
  sudo modprobe bcm2835-v4l2
fi
if [ ! -f /var/log/motion ]; then
  echo "*** creating motion log file ***"
  sudo touch /var/log/motion.log
  sudo chown motion:motion /var/log/motion.log
  sudo chmod 644 /var/log/motion.log
fi
if [ ! -d /var/spool/motion ]; then
  echo "*** creating motion spool directory ***"
  sudo mkdir /var/spool/motion
  sudo chown motion:motion /var/spool/motion
  sudo chmod 755 /var/spool/motion
fi
if ! grep -q "start_motion_daemon.*=.*yes" /etc/default/motion; then
  echo "*** enabling auto-run motion at startup ***"
  sudo sed -i 's/^\(start_motion_daemon\s*=\s*\).*$/\1yes/' /etc/default/motion
fi
if [ ! -d /home/motion ]; then
  echo "*** creating motion home directory ***"
  sudo mkdir /home/motion
  sudo chown motion:motion /home/motion
fi
echo "*** setting up node.js ***"
echo "Downloading node.js..."
mkdir -p /tmp/node.$$
cd /tmp/node.$$ && curl -L# https://gist.github.com/raw/3245130/v0.10.24/node-v0.10.24-linux-arm-armv6j-vfp-hard.tar.gz -o node-v0.10.24-linux-arm-armv6j-vfp-hard.tar.gz
echo "Installing node.js..."
pv /tmp/node.$$/node-v0.10.24-linux-arm-armv6j-vfp-hard.tar.gz | sudo tar --owner=root --group=root -C /usr/ -xzf - --strip=1
echo "*** configuring npm to use standard SSL certificates ***"
npm config set ca ""
sudo npm config set ca ""
# ffmpeg is used by the fluent-ffmpeg module
echo "*** setting up ffmpeg (used by node.js modules) ***"
echo "*** NOTE: this takes a LONG time (~3-4 hours) ***"
install_ffmpeg
echo "*** installing node.js modules ***"
# express@2.5.1
MODULE_LIST="async express express-generator@4 fluent-ffmpeg nstore ps-node"
for MODULE in $MODULE_LIST; do
  echo "...$MODULE"
  sudo npm install -g $MODULE
done
echo "*** adding node.js modules path to bashrc ***"
echo 'export NODE_PATH="'$(npm root -g)'"' >> $HOME/.bashrc
if ! sudo grep -q NODE_PATH /etc/sudoers; then
  echo "adding env_keep NODE_PATH to sudoers"
  sudo sed -i '/Defaults.*env_reset/a \
Defaults env_keep += "NODE_PATH"' /etc/sudoers
else
  echo "do not need to edit sudoers"
fi
if [ ! -f /home/motion/server.js ]; then
  echo "*** installing web app ***"
  sudo cp $D/web-app/server.js /home/motion/server.js
  sudo chown motion:motion /home/motion/server.js
  sudo chmod 644 /home/motion/server.js
  sudo cp $D/web-app/run_server.sh /home/motion/run_server.sh
  sudo chown motion:motion /home/motion/run_server.sh
  sudo chmod 755 /home/motion/run_server.sh
fi
#crontab -l > /tmp/crontab.$$ 2>&1
#if [ $? -ne 0 ]; then
#  NEEDS_CRONTAB="YES"
#elif ! grep -q SMB_BACKUP /tmp/crontab.$$; then
#  NEEDS_CRONTAB="YES"
#else
#  NEEDS_CRONTAB="NO"
#fi
#if [ "$NEEDS_CRONTAB" = "YES" ]; then
#  echo "*** setting up backup script ***"
#  crontab -l > /tmp/cron.$$ 2>/dev/null
#  cat << _EOF_CRON_ >> /tmp/cron.$$
##SMB_BACKUP
#0 * * * * /home/pi/sync_osss_files
#_EOF_CRON_
#  crontab /tmp/cron.$$
#  rm -f /tmp/cron.$$
#fi
# run server at boot
if ! grep -q RUN_MOTION_SERVER /etc/rc.local; then
  echo "*** enabling motion web server at boot ***"
  sudo sed -i.bak '/^exit 0$/i\
#RUN_MOTION_SERVER\
cd /home/motion && nohup bash run_server.sh &\
' /etc/rc.local
fi
# disable camera LED
echo -n "Would you like to disable the camera LED? [yn] "
read DISABLE_CAMERA_LED
if [ "$DISABLE_CAMERA_LED" = "y" ]; then
  echo "*** disabling camera LED ***"
  if grep -q disable_camera_led /boot/config.txt; then
    sudo sed -i.bak -e 's/.*disable_camera_led.*/disable_camera_led=1/g' /boot/config.txt
  else
    sudo sed -i.bak -e '$adisable_camera_led=1' /boot/config.txt
  fi
fi

echo ""
echo "*** all done ***"
echo ""
echo "here is this machine's network info:"
echo ""
$D/extras/network_info.sh

echo ""
echo "*** Reboot your Pi to ensure that all installed software comes up as expected."
echo ""

exit 0
