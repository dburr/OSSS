# osss
Open Source Surveillance and Security - a set of scripts/configs and a web front-end to turn a Raspberry Pi into a motion-detecting security camera

# What is this?

Basically this will turn your Raspberry Pi + Raspberry Pi camera module
into a web-accessible, recording, motion-detecting, live-streaming security
and surveillance camera.

For more info, check out my talk about it at SCaLE 2014.  (link coming
as soon as I've had a chance to put up the slides/video.)

# How to set this up?

Just run `install.sh`, it will guide you through the whole shebang.
Easy peasy.

# Some Extra Stuff

I've included a few extra scripts in the `extras` directory, those are:

* `network_info.sh` - prints out your Pi's network information (IP and MAC
  addresses.)
* `setup_smb.sh` - sets up a Samba (SMB, CIFS) mount point, handy for
  archiving older recordings off of the Pi (to save room on your SD card.)
* `setup_wifi.sh` - a script that helps you set up a WiFi connection.
  (requires two data files that are also in this directory, `interfaces.wifi`
  and `wpa_supplicant.conf`.)
* `sync_osss_files.sh` - a script that uses `rsync` to periodically copy
  all recordings to another directory (by default, an SMB mount.)  Useful
  for archiving older recordings so that they don't take up your Pi's
  precious SD card space.

# Need More Info?

If you need more info, are having a problem, or just have a question, please
feel free to drop me an e-mail at `dburr [at] vctlabs [dot] com`.

# Share And Enjoy!
