#!/bin/sh
if [ ! -f /var/log/rsync.log ]; then
  sudo touch /var/log/rsync.log
  sudo chown pi:pi /var/log/rsync.log
fi
echo "### rsync begin at `date`" >> /var/log/rsync.log
if mount -l | grep -q \/smb; then
  if [ ! -d /smb/`hostname` ]; then
    mkdir -p /smb/`hostname`
  fi
  rsync -avs /var/spool/motion/ /smb/`hostname`/ >> /var/log/rsync.log 2>&1
else
  echo "### error: filesystem is not mounted" >> /var/log/rsync.log
fi
echo "### rsync end at `date`" >> /var/log/rsync.log
