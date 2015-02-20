#!/bin/sh

if [ ! -d /smb ]; then
  sudo mkdir /smb
  sudo chown pi:pi /smb
fi

if mount -l | grep -q \/smb; then
  sudo umount /smb
fi

if grep -q "\/smb" /etc/fstab; then
  sudo sed -i '/\/smb/d' /etc/fstab
fi

echo -n "Are you mounting a public (passwordless) share? [yn] "
read PUBLIC

echo -n "Enter the hostname or IP address of your file server: "
read HOST

echo -n "Is this a Mac OS X machine? [yn] "
read MAC
if [ "$MAC" = "y" ]; then
  EXTRA=",sec=ntlmssp,nounix"
else
  EXTRA=""
fi

echo -n "Enter the file share you wish to mount: "
read SHARE

if [ "$PUBLIC" = "y" ]; then
  sudo sed -i.bak -e "\$a\
//$HOST/$SHARE /smb cifs guest,uid=1000,gid=1000,iocharset=utf8$EXTRA 0 0" /etc/fstab
else
  echo -n "Enter the username to login as: "
  read USER

  PASSWORD="foo"
  PASSWORD_TEMP="bar"
  stty -echo
  while [ "$PASSWORD" != "$PASSWORD_TEMP" ]; do
    echo -n "Enter password: "
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

  (echo "username=$USER"
  echo "password=$PASSWORD") > /tmp/smb.$$

  sudo cp /tmp/smb.$$ /etc/smb_credentials
  sudo chown root:root /etc/smb_credentials
  sudo chmod 600 /etc/smb_credentials
  rm -f /tmp/smb.**

  sudo sed -i.bak -e "\$a\
//$HOST/$SHARE /smb cifs credentials=/etc/smb_credentials,uid=1000,gid=1000,iocharset=utf8$EXTRA 0 0" /etc/fstab
fi

echo "Attempting to mount the filesystem..."
sudo mount /smb
if [ $? -eq 0 ]; then
  echo "Success."
  exit 0
else
  echo "Error: unable to mount.  Please try running this script again, and ensure"
  echo "that you typed in all values (hostname, user/pass, etc.) correctly."
  exit 1
fi
