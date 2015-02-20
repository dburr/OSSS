#!/bin/bash
export NODE_PATH="$(npm root -g)"
#echo $NODE_PATH
while true; do
  if [ -f "STOP" ]; then
    rm -f STOP
    exit 0
  fi
  node server.js
  sleep 5
done
